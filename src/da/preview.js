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
  createDaContext,
  flushDaPreview,
  parseConcurrency,
  previewUrl,
  printResult,
  resolvePathSet,
  runConcurrent,
} from './shared.js';

function addBatchOptions(yargs) {
  return yargs
    .option('concurrency', {
      describe: 'Max parallel preview requests.',
      type: 'number',
      default: 5,
    });
}

function addPathOptions(yargs) {
  return addProjectOptions(yargs)
    .positional('path', {
      describe: 'DA source path.',
      type: 'string',
    });
}

function addTreeOptions(yargs) {
  return addBatchOptions(addProjectOptions(yargs))
    .positional('prefix', {
      describe: 'DA source path prefix.',
      type: 'string',
      default: '/',
    });
}

async function previewOne(ctx, daPath) {
  try {
    await flushDaPreview(ctx, daPath);
  } catch (e) {
    ctx.log.debug(`DA preview flush skipped for ${daPath}: ${e.message}`);
  }
  const result = await ctx.helixClient.preview(ctx.owner, ctx.repo, ctx.branch, daPath);
  return {
    path: daPath,
    url: result?.preview?.url || previewUrl(ctx.owner, ctx.repo, ctx.branch, daPath),
    status: 'ok',
  };
}

export default function preview() {
  return {
    command: 'preview <subcommand>',
    description: 'Trigger Edge Delivery preview builds on *.aem.page',
    builder: (yargs) => {
      yargs
        .command({
          command: 'page <path>',
          description: 'Preview one DA source document.',
          builder: addPathOptions,
          handler: async (argv) => {
            const ctx = await createDaContext(argv);
            const result = await previewOne(ctx, argv.path);
            // eslint-disable-next-line no-console
            console.log(result.url);
          },
        })
        .command({
          command: 'tree [prefix]',
          description: 'Preview every HTML source document under a DA path prefix.',
          builder: addTreeOptions,
          handler: async (argv) => {
            const ctx = await createDaContext(argv);
            const paths = await resolvePathSet(ctx, argv.prefix || '/', { htmlOnly: true });
            const concurrency = parseConcurrency(argv.concurrency);
            ctx.log.info(`Previewing ${paths.length} page(s) with concurrency ${concurrency}`);
            const results = await runConcurrent(
              paths.map((daPath) => async () => {
                try {
                  return previewOne(ctx, daPath);
                } catch (e) {
                  return { path: daPath, url: '', status: `error: ${e.message}` };
                }
              }),
              concurrency,
            );
            printResult(results);
          },
        })
        .command({
          command: 'status <path>',
          description: 'Show Helix preview status for one path.',
          builder: addPathOptions,
          handler: async (argv) => {
            const ctx = await createDaContext(argv);
            const result = await ctx.helixClient.previewStatus(
              ctx.owner,
              ctx.repo,
              ctx.branch,
              argv.path,
            );
            printResult(result);
          },
        })
        .demandCommand(1, 'You need at least one preview subcommand.')
        .help();
    },
    handler: () => {},
  };
}
