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
  printResult,
} from './shared.js';

function addCodeWriteOptions(yargs) {
  return addCommitOptions(addProjectOptions(yargs));
}

function addCodePathOptions(yargs) {
  return addCodeWriteOptions(yargs)
    .positional('path', {
      describe: 'Code-bus path.',
      type: 'string',
      default: '/',
    });
}

function addCodeStatusOptions(yargs) {
  return addProjectOptions(yargs)
    .positional('path', {
      describe: 'Code-bus path.',
      type: 'string',
      default: '/',
    });
}

function addCodeJobOptions(yargs) {
  return addProjectOptions(yargs)
    .positional('jobId', {
      describe: 'Helix Admin job ID.',
      type: 'string',
    });
}

export default function code() {
  return {
    command: 'code <subcommand>',
    description: 'Inspect and trigger Edge Delivery code-bus operations',
    builder: (yargs) => {
      yargs
        .command({
          command: 'sync [path]',
          description: 'Trigger code-bus sync for a path. Requires --commit.',
          builder: addCodePathOptions,
          handler: async (argv) => {
            const path = argv.path || '/';
            const project = await createProjectContext(argv);
            project.log.info(`Target: ${project.owner}/${project.repo}#${project.branch}`);
            if (!guardCommit(argv, project.log, `Code sync ${path}`)) {
              return;
            }
            const ctx = await createDaContext(argv);
            printResult(await ctx.helixClient.codeSync(ctx.owner, ctx.repo, ctx.branch, path));
          },
        })
        .command({
          command: 'status [path]',
          description: 'Check code-bus sync status for a path.',
          builder: addCodeStatusOptions,
          handler: async (argv) => {
            const path = argv.path || '/';
            const ctx = await createDaContext(argv);
            printResult(await ctx.helixClient.codeStatus(ctx.owner, ctx.repo, ctx.branch, path));
          },
        })
        .command({
          command: 'job <jobId>',
          description: 'Show an async Helix Admin job by ID.',
          builder: addCodeJobOptions,
          handler: async (argv) => {
            const ctx = await createDaContext(argv);
            printResult(await ctx.helixClient.job(argv.jobId));
          },
        })
        .command({
          command: 'sidekick',
          description: 'Read the Helix sidekick configuration for this repo.',
          builder: (cmd) => {
            cmd
              .command({
                command: 'get',
                description: 'Print current sidekick config as JSON.',
                builder: addProjectOptions,
                handler: async (argv) => {
                  const ctx = await createDaContext(argv);
                  const result = await ctx.helixClient.sidekickConfig(
                    ctx.owner,
                    ctx.repo,
                    ctx.branch,
                  );
                  printResult(result);
                },
              })
              .demandCommand(1, 'You need at least one sidekick subcommand.')
              .help();
          },
          handler: () => {},
        })
        .demandCommand(1, 'You need at least one code subcommand.')
        .help();
    },
    handler: () => {},
  };
}
