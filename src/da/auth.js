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
import path from 'path';
import fse from 'fs-extra';
import { getOrCreateLogger } from '../log-common.js';
import { DA_TOKEN_FILE, getValidToken } from '../content/da-auth.js';

function tokenPath() {
  return path.join(process.cwd(), DA_TOKEN_FILE);
}

async function readToken() {
  try {
    return await fse.readJson(tokenPath());
  } catch {
    return null;
  }
}

export default function auth() {
  return {
    command: 'auth <subcommand>',
    description: 'Authenticate with Adobe IMS for DA and Helix Admin operations',
    builder: (yargs) => {
      yargs
        .command({
          command: 'login',
          description: 'Obtain and cache a DA Bearer token.',
          builder: (cmd) => cmd.option('token', {
            describe: 'Use this IMS Bearer token instead of opening the browser.',
            type: 'string',
          }),
          handler: async (argv) => {
            const log = getOrCreateLogger(argv);
            await getValidToken(log, argv.token, process.cwd());
            log.info(`Authenticated. Token cached at ${tokenPath()}`);
          },
        })
        .command({
          command: 'logout',
          description: 'Remove the cached DA token.',
          handler: async () => {
            if (await fse.pathExists(tokenPath())) {
              await fse.remove(tokenPath());
              // eslint-disable-next-line no-console
              console.log('Token removed.');
            } else {
              // eslint-disable-next-line no-console
              console.log('No cached token found.');
            }
          },
        })
        .command({
          command: 'status',
          description: 'Show cached token validity and expiry.',
          handler: async () => {
            const stored = await readToken();
            if (!stored?.access_token) {
              // eslint-disable-next-line no-console
              console.log('invalid  no cached token found');
              process.exitCode = 1;
              return;
            }
            if (!stored.expires_at || Date.now() >= stored.expires_at) {
              // eslint-disable-next-line no-console
              console.log('invalid  token expired');
              process.exitCode = 1;
              return;
            }
            const mins = Math.round((stored.expires_at - Date.now()) / 60_000);
            // eslint-disable-next-line no-console
            console.log(`valid  expires ${new Date(stored.expires_at).toLocaleString()}  (~${mins} min remaining)`);
          },
        })
        .command({
          command: 'token',
          description: 'Print the cached raw Bearer token.',
          handler: async () => {
            const stored = await readToken();
            if (!stored?.access_token) {
              throw new Error('No cached token found. Run `aem auth login` first.');
            }
            process.stdout.write(stored.access_token);
          },
        })
        .demandCommand(1, 'You need at least one auth subcommand.')
        .help();
    },
    handler: () => {},
  };
}
