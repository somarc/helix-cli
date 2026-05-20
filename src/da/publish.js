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
  addCommitOptions,
  addProjectOptions,
  createDaContext,
  createProjectContext,
  guardCommit,
  liveUrl,
  parseConcurrency,
  printResult,
  resolvePathSet,
  runConcurrent,
} from './shared.js';

function addBatchOptions(yargs) {
  return yargs
    .option('concurrency', {
      describe: 'Max parallel publish requests.',
      type: 'number',
      default: 5,
    });
}

function addPublishOptions(yargs) {
  return addCommitOptions(addProjectOptions(yargs));
}

function addPublishPathOptions(yargs) {
  return addPublishOptions(yargs)
    .positional('path', {
      describe: 'DA source path.',
      type: 'string',
    });
}

function addPublishTreeOptions(yargs) {
  return addBatchOptions(addPublishOptions(yargs))
    .positional('prefix', {
      describe: 'DA source path prefix.',
      type: 'string',
      default: '/',
    });
}

async function publishOne(ctx, daPath) {
  const result = await ctx.helixClient.live(ctx.owner, ctx.repo, ctx.branch, daPath);
  return {
    path: daPath,
    url: result?.live?.url || liveUrl(ctx.owner, ctx.repo, ctx.branch, daPath),
    status: 'ok',
  };
}

export default function publish() {
  return {
    command: 'publish <subcommand>',
    description: 'Promote previewed pages to *.aem.live',
    builder: (yargs) => {
      yargs
        .command({
          command: 'page <path>',
          description: 'Publish one page. Requires --commit.',
          builder: addPublishPathOptions,
          handler: async (argv) => {
            const project = await createProjectContext(argv);
            project.log.info(`Target: ${project.owner}/${project.repo}#${project.branch}`);
            if (!guardCommit(argv, project.log, `Publish ${argv.path}`)) {
              return;
            }
            const ctx = await createDaContext(argv);
            const result = await publishOne(ctx, argv.path);
            // eslint-disable-next-line no-console
            console.log(result.url);
          },
        })
        .command({
          command: 'tree [prefix]',
          description: 'Publish every HTML source document under a DA path prefix. Requires --commit.',
          builder: addPublishTreeOptions,
          handler: async (argv) => {
            const ctx = await createDaContext(argv);
            const paths = await resolvePathSet(ctx, argv.prefix || '/', { htmlOnly: true });
            const concurrency = parseConcurrency(argv.concurrency);
            ctx.log.info(`Target: ${ctx.owner}/${ctx.repo}#${ctx.branch}`);
            ctx.log.info(`Paths: ${paths.length}`);
            if (!guardCommit(argv, ctx.log, `Publish ${paths.length} page(s)`)) {
              return;
            }
            const results = await runConcurrent(
              paths.map((daPath) => async () => {
                try {
                  return publishOne(ctx, daPath);
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
          command: 'unpublish <path>',
          description: 'Remove one page from *.aem.live. Requires --commit.',
          builder: addPublishPathOptions,
          handler: async (argv) => {
            const project = await createProjectContext(argv);
            project.log.info(`Target: ${project.owner}/${project.repo}#${project.branch}`);
            if (!guardCommit(argv, project.log, `Unpublish ${argv.path}`)) {
              return;
            }
            const ctx = await createDaContext(argv);
            await ctx.helixClient.unpublish(ctx.owner, ctx.repo, ctx.branch, argv.path);
            ctx.log.info(`Unpublished ${argv.path}`);
          },
        })
        .demandCommand(1, 'You need at least one publish subcommand.')
        .help();
    },
    handler: () => {},
  };
}
