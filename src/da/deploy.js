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
  flushDaPreview,
  guardCommit,
  liveUrl,
  previewUrl,
} from './shared.js';

function addDeployOptions(yargs) {
  return addCommitOptions(addProjectOptions(yargs));
}

export default function deploy() {
  return {
    command: 'deploy <subcommand>',
    description: 'Preview then publish Edge Delivery pages',
    builder: (yargs) => {
      yargs
        .command({
          command: 'page <path>',
          description: 'Preview one page, then publish it when --commit is supplied.',
          builder: addDeployOptions,
          handler: async (argv) => {
            const ctx = await createDaContext(argv);
            try {
              await flushDaPreview(ctx, argv.path);
            } catch (e) {
              ctx.log.debug(`DA preview flush skipped for ${argv.path}: ${e.message}`);
            }
            await ctx.helixClient.preview(ctx.owner, ctx.repo, ctx.branch, argv.path);
            ctx.log.info(`Previewed: ${previewUrl(ctx.owner, ctx.repo, ctx.branch, argv.path)}`);
            if (!guardCommit(argv, ctx.log, `Publish ${argv.path}`)) {
              return;
            }
            await ctx.helixClient.live(ctx.owner, ctx.repo, ctx.branch, argv.path);
            ctx.log.info(`Published: ${liveUrl(ctx.owner, ctx.repo, ctx.branch, argv.path)}`);
          },
        })
        .demandCommand(1, 'You need at least one deploy subcommand.')
        .help();
    },
    handler: () => {},
  };
}
