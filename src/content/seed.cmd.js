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
import processQueue from '@adobe/helix-shared-process-queue';
import GitUtils from '../git-utils.js';
import { DaClient, getContentType } from './da-api.js';
import { getValidToken } from './da-auth.js';
import { CONTENT_IO_CONCURRENCY, normalizeDaPath } from './content-shared.js';

const SUPPORTED_EXTENSIONS = new Set(['html', 'json', 'txt', 'xml', 'svg', 'md']);

async function collectFiles(root) {
  const files = [];
  async function visit(dir) {
    const entries = await fse.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await visit(abs);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).slice(1).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          files.push(abs);
        }
      }
    }
  }
  await visit(root);
  return files;
}

function toDaPath(sourceRoot, filePath, destinationPath) {
  const rel = path.relative(sourceRoot, filePath).split(path.sep).join('/');
  const prefix = normalizeDaPath(destinationPath);
  return normalizeDaPath(path.posix.join(prefix, rel));
}

export default class SeedCommand {
  constructor(logger) {
    this.log = logger;
    this._dir = process.cwd();
    this._destinationPath = '/';
    this._commit = false;
  }

  withDirectory(dir) {
    this._dir = dir;
    return this;
  }

  withSourceDirectory(dir) {
    this._sourceDirectory = dir;
    return this;
  }

  withOwner(owner) {
    this._owner = owner;
    return this;
  }

  withRepo(repo) {
    this._repo = repo;
    return this;
  }

  withDestinationPath(destinationPath) {
    this._destinationPath = destinationPath || '/';
    return this;
  }

  withToken(token) {
    this._token = token;
    return this;
  }

  withCommit(commit) {
    this._commit = !!commit;
    return this;
  }

  async run() {
    if (!this._sourceDirectory) {
      throw new Error('Seed source directory was not set.');
    }
    const sourceRoot = path.resolve(this._dir, this._sourceDirectory);
    if (!await fse.pathExists(sourceRoot)) {
      throw new Error(`Seed source directory not found: ${sourceRoot}`);
    }

    const origin = await GitUtils.getOriginURL(this._dir);
    const owner = this._owner || origin?.owner;
    const repo = this._repo || origin?.repo;
    if (!owner || !repo) {
      throw new Error('Missing owner/repo. Pass --owner and --repo, or run inside a git repo with origin.');
    }

    const files = await collectFiles(sourceRoot);
    const rows = files.map((file) => ({
      file,
      daPath: toDaPath(sourceRoot, file, this._destinationPath),
      contentType: getContentType(path.extname(file).slice(1)),
    }));

    this.log.info(`Target: ${owner}/${repo}${normalizeDaPath(this._destinationPath)}`);
    this.log.info(`Documents: ${rows.length}`);
    rows.forEach(({ daPath }) => this.log.info(`  ${daPath}`));

    if (!this._commit) {
      this.log.info('[dry-run] Pass --commit to seed documents into da.live.');
      return { seeded: 0, dryRun: true, documents: rows };
    }

    const token = await getValidToken(this.log, this._token, this._dir);
    const client = new DaClient(token);
    let seeded = 0;
    await processQueue(
      [...rows],
      async ({ file, daPath, contentType }) => {
        const buffer = await fse.readFile(file);
        await client.putSource(owner, repo, daPath, buffer, contentType);
        seeded += 1;
        this.log.info(`Seeded ${daPath}`);
      },
      CONTENT_IO_CONCURRENCY,
    );
    return { seeded, dryRun: false, documents: rows };
  }
}
