/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import {
  addProjectOptions,
  canonicalWebPath,
  createDaContext,
  liveUrl,
  parseConcurrency,
  plainHtmlUrl,
  previewUrl,
  printResult,
  resolvePathSet,
  runConcurrent,
} from './shared.js';

const EXIT_CODES = {
  contentbus: 0,
  orphan: 2,
  codebus: 3,
  hybrid: 4,
  'probe-failed': 5,
};

function addRoutePathOptions(yargs) {
  return addProjectOptions(yargs)
    .positional('path', {
      describe: 'Route or DA source path.',
      type: 'string',
    });
}

function addRouteAuditOptions(yargs) {
  return addProjectOptions(yargs)
    .positional('prefix', {
      describe: 'DA source path prefix.',
      type: 'string',
      default: '/',
    })
    .option('concurrency', {
      describe: 'Max parallel probes.',
      type: 'number',
      default: 10,
    });
}

async function probeSource(ctx, daPath) {
  const candidates = daPath.endsWith('.html') ? [daPath] : [`${daPath}.html`, daPath];
  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const res = await ctx.daClient.getSource(ctx.owner, ctx.repo, candidate);
    if (res) {
      return { hasSource: true, sourcePath: candidate };
    }
  }
  return { hasSource: false, sourcePath: candidates[0] };
}

export async function classifyRoute(ctx, daPath) {
  const [sourceResult, statusResult] = await Promise.allSettled([
    probeSource(ctx, daPath),
    ctx.helixClient.previewStatus(ctx.owner, ctx.repo, ctx.branch, daPath),
  ]);
  const probeErrors = [];
  if (sourceResult.status === 'rejected') {
    probeErrors.push(`source: ${sourceResult.reason?.message || sourceResult.reason}`);
  }
  if (statusResult.status === 'rejected') {
    probeErrors.push(`helix-status: ${statusResult.reason?.message || statusResult.reason}`);
  }
  if (probeErrors.length) {
    return {
      path: daPath,
      ownership: 'probe-failed',
      probeErrors,
      daSource: null,
      sourcePath: daPath,
    };
  }

  const { hasSource, sourcePath } = sourceResult.value;
  const helixStatus = statusResult.value;
  const sourceLocation = helixStatus.preview?.sourceLocation
    || helixStatus.live?.sourceLocation
    || '';
  const previewStatus = helixStatus.preview?.status || 0;
  const liveStatus = helixStatus.live?.status || 0;
  const isDaContent = sourceLocation.includes('content.da.live');
  const isCodeContent = sourceLocation.startsWith('https://') && !isDaContent;

  let ownership;
  if ((hasSource || isDaContent) && isCodeContent) {
    ownership = 'hybrid';
  } else if (hasSource || isDaContent) {
    ownership = 'contentbus';
  } else if (isCodeContent) {
    ownership = 'codebus';
  } else {
    ownership = 'orphan';
  }

  return {
    path: daPath,
    ownership,
    daSource: hasSource,
    sourcePath,
    preview: previewStatus,
    live: liveStatus,
    sourceLocation: sourceLocation || null,
  };
}

export default function route() {
  return {
    command: 'route <subcommand>',
    description: 'Classify DA route ownership and canonical delivery URLs',
    builder: (yargs) => {
      yargs
        .command({
          command: 'classify <path>',
          description: 'Probe route ownership: contentbus | codebus | hybrid | orphan.',
          builder: addRoutePathOptions,
          handler: async (argv) => {
            const ctx = await createDaContext(argv);
            const verdict = await classifyRoute(ctx, argv.path);
            printResult(verdict);
            process.exitCode = EXIT_CODES[verdict.ownership] || 1;
          },
        })
        .command({
          command: 'canonical <path>',
          description: 'Show canonical route, preview/live URLs, and .plain.html URL.',
          builder: addRoutePathOptions,
          handler: async (argv) => {
            const ctx = await createDaContext(argv);
            const verdict = await classifyRoute(ctx, argv.path);
            const sourcePath = verdict.sourcePath || argv.path;
            printResult({
              input: argv.path,
              sourcePath,
              canonicalPath: canonicalWebPath(sourcePath),
              ownership: verdict.ownership,
              daSource: verdict.daSource,
              previewStatus: verdict.preview,
              liveStatus: verdict.live,
              sourceLocation: verdict.sourceLocation,
              previewUrl: previewUrl(ctx.owner, ctx.repo, ctx.branch, sourcePath),
              liveUrl: liveUrl(ctx.owner, ctx.repo, ctx.branch, sourcePath),
              plainHtmlUrl: plainHtmlUrl(ctx.owner, ctx.repo, ctx.branch, sourcePath),
            });
          },
        })
        .command({
          command: 'audit [prefix]',
          description: 'Classify every HTML source route under a DA path prefix.',
          builder: addRouteAuditOptions,
          handler: async (argv) => {
            const ctx = await createDaContext(argv);
            const paths = await resolvePathSet(ctx, argv.prefix || '/', { htmlOnly: true });
            const concurrency = parseConcurrency(argv.concurrency);
            ctx.log.info(`Classifying ${paths.length} route(s) with concurrency ${concurrency}`);
            const results = await runConcurrent(
              paths.map((daPath) => async () => classifyRoute(ctx, daPath).catch((e) => ({
                path: daPath,
                ownership: 'probe-failed',
                error: e.message,
              }))),
              concurrency,
            );
            printResult(results);
          },
        })
        .demandCommand(1, 'You need at least one route subcommand.')
        .help();
    },
    handler: () => {},
  };
}
