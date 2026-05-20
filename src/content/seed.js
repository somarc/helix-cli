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
import { getOrCreateLogger } from '../log-common.js';

export default function seed() {
  let executor;
  return {
    set executor(value) {
      executor = value;
    },
    command: 'seed <directory>',
    description: 'Seed local authored documents into da.live source storage',
    builder: (yargs) => {
      yargs
        .positional('directory', {
          describe: 'Local directory containing authored source documents to seed.',
          type: 'string',
        })
        .option('owner', {
          describe: 'GitHub owner / DA org. Defaults to git origin owner.',
          type: 'string',
        })
        .option('org', {
          describe: 'Alias for --owner.',
          type: 'string',
        })
        .option('repo', {
          describe: 'GitHub repository / DA repo. Defaults to git origin repository.',
          type: 'string',
        })
        .option('path', {
          describe: 'DA destination prefix.',
          type: 'string',
          default: '/',
        })
        .option('token', {
          describe: 'IMS Bearer token for da.live authentication.',
          type: 'string',
        })
        .option('commit', {
          describe: 'Write documents to da.live. Without this flag the command is dry-run.',
          type: 'boolean',
          default: false,
        })
        .option('dry-run', {
          alias: 'dryRun',
          describe: 'Show what would be seeded without writing.',
          type: 'boolean',
          default: false,
        })
        .help();
    },
    handler: async (argv) => {
      if (!executor) {
        const SeedCommand = (await import('./seed.cmd.js')).default;
        executor = new SeedCommand(getOrCreateLogger(argv));
      }
      await executor
        .withDirectory(process.cwd())
        .withSourceDirectory(argv.directory)
        .withOwner(argv.owner || argv.org)
        .withRepo(argv.repo)
        .withDestinationPath(argv.path)
        .withToken(argv.token)
        .withCommit(argv.commit && !argv.dryRun)
        .run();
    },
  };
}
