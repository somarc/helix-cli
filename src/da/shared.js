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
import processQueue from '@adobe/helix-shared-process-queue';
import GitUtils from '../git-utils.js';
import { getFetch } from '../fetch-utils.js';
import { getOrCreateLogger } from '../log-common.js';
import { DaClient } from '../content/da-api.js';
import { getValidToken } from '../content/da-auth.js';
import { normalizeDaPath } from '../content/content-shared.js';

const HELIX_ADMIN = 'https://admin.hlx.page';
const CONCURRENCY = 5;

function helixPath(daPath) {
  return normalizeDaPath(daPath).replace(/\.html$/i, '').replace(/^\//, '') || 'index';
}

export function canonicalWebPath(daPath) {
  const stripped = normalizeDaPath(daPath).replace(/\.html$/i, '');
  if (stripped === '/index') {
    return '/';
  }
  return stripped.replace(/\/index$/i, '/');
}

export function addProjectOptions(yargs) {
  return yargs
    .option('owner', {
      describe: 'GitHub owner / DA org. Defaults to the git origin owner.',
      type: 'string',
    })
    .option('org', {
      describe: 'Alias for --owner.',
      type: 'string',
    })
    .option('repo', {
      describe: 'GitHub repository / DA repo. Defaults to the git origin repository.',
      type: 'string',
    })
    .option('branch', {
      describe: 'Git branch for Helix Admin operations.',
      type: 'string',
    })
    .option('token', {
      describe: 'IMS Bearer token for da.live and Helix Admin authentication.',
      type: 'string',
    });
}

export function addCommitOptions(yargs) {
  return yargs
    .option('commit', {
      describe: 'Execute the remote mutation. Without this flag the command prints a dry-run preflight.',
      type: 'boolean',
      default: false,
    })
    .option('dry-run', {
      alias: 'dryRun',
      describe: 'Show what would happen without mutating.',
      type: 'boolean',
      default: false,
    });
}

export class HelixAdminClient {
  constructor(token) {
    this.token = token;
    this.fetch = getFetch(false);
  }

  async preview(owner, repo, branch, daPath) {
    return this._json(
      `/preview/${owner}/${repo}/${branch}/${helixPath(daPath)}`,
      { method: 'POST' },
    );
  }

  async previewStatus(owner, repo, branch, daPath) {
    return this._json(`/status/${owner}/${repo}/${branch}/${helixPath(daPath)}`);
  }

  async live(owner, repo, branch, daPath) {
    return this._json(
      `/live/${owner}/${repo}/${branch}/${helixPath(daPath)}`,
      { method: 'POST' },
    );
  }

  async unpublish(owner, repo, branch, daPath) {
    return this._json(
      `/live/${owner}/${repo}/${branch}/${helixPath(daPath)}`,
      { method: 'DELETE' },
    );
  }

  async codeSync(owner, repo, branch, daPath) {
    return this._json(
      `/code/${owner}/${repo}/${branch}/${helixPath(daPath)}`,
      { method: 'POST' },
    );
  }

  async codeStatus(owner, repo, branch, daPath) {
    return this._json(`/code/${owner}/${repo}/${branch}/${helixPath(daPath)}`);
  }

  async job(jobId) {
    return this._json(`/job/${jobId}/details`);
  }

  async sidekickConfig(owner, repo, branch) {
    return this._json(`/sidekick/${owner}/${repo}/${branch}/config.json`);
  }

  async _json(endpoint, opts = {}) {
    const res = await this.fetch(`${HELIX_ADMIN}${endpoint}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Helix Admin ${res.status} at ${endpoint}${text ? `: ${text.slice(0, 200)}` : ''}`,
      );
    }
    return res.json().catch(() => ({}));
  }
}

export async function createProjectContext(argv) {
  const log = getOrCreateLogger(argv);
  const dir = process.cwd();
  const origin = await GitUtils.getOriginURL(dir);
  const owner = argv.owner
    || argv.org
    || process.env.AEM_OWNER
    || process.env.AEM_ORG
    || process.env.DA_ORG
    || origin?.owner;
  const repo = argv.repo || process.env.AEM_REPO || process.env.DA_REPO || origin?.repo;
  const branch = argv.branch
    || process.env.AEM_BRANCH
    || process.env.DA_BRANCH
    || await GitUtils.getBranch(dir);

  if (!owner) {
    throw new Error(
      'Missing owner. Pass --owner, set AEM_OWNER, or run inside a git repo with an origin remote.',
    );
  }
  if (!repo) {
    throw new Error(
      'Missing repo. Pass --repo, set AEM_REPO, or run inside a git repo with an origin remote.',
    );
  }

  return {
    log,
    dir,
    owner,
    repo,
    branch,
  };
}

export async function createDaContext(argv) {
  const project = await createProjectContext(argv);
  const token = await getValidToken(project.log, argv.token, project.dir);
  const daClient = new DaClient(token);
  const helixClient = new HelixAdminClient(token);
  return {
    ...project,
    token,
    daClient,
    helixClient,
  };
}

export async function flushDaPreview(ctx, daPath) {
  const res = await ctx.daClient.fetch(
    `https://admin.da.live/preview/${ctx.owner}/${ctx.repo}${normalizeDaPath(daPath)}`,
    {
      method: 'POST',
      headers: ctx.daClient.authHeader,
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `DA preview flush failed for ${daPath}: ${res.status}${text ? ` ${text.slice(0, 200)}` : ''}`,
    );
  }
}

export async function resolvePathSet(ctx, source, { htmlOnly = false } = {}) {
  const normalized = normalizeDaPath(source);
  if (!source.endsWith('/') && /\.[a-z0-9]+$/i.test(source)) {
    return [normalized];
  }
  const files = await ctx.daClient.listAll(ctx.owner, ctx.repo, normalized);
  return files
    .map((item) => item.path.replace(`/${ctx.owner}/${ctx.repo}`, '') || '/')
    .filter((itemPath) => !htmlOnly || /\.html$/i.test(itemPath));
}

export async function runConcurrent(tasks, concurrency = CONCURRENCY) {
  return processQueue([...tasks], (task) => task(), concurrency);
}

export function parseConcurrency(value) {
  return Math.max(1, parseInt(value, 10) || CONCURRENCY);
}

export function printResult(result) {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
}

export function guardCommit(argv, log, description) {
  if (argv.commit && !argv.dryRun) {
    return true;
  }
  log.info(`[dry-run] ${description}`);
  log.info('Pass --commit to execute.');
  return false;
}

export function previewUrl(owner, repo, branch, daPath) {
  return `https://${branch}--${repo}--${owner}.aem.page${canonicalWebPath(daPath)}`;
}

export function liveUrl(owner, repo, branch, daPath) {
  return `https://${branch}--${repo}--${owner}.aem.live${canonicalWebPath(daPath)}`;
}

export function plainHtmlUrl(owner, repo, branch, daPath) {
  const stripped = normalizeDaPath(daPath).replace(/\.html$/i, '');
  const segment = stripped === '/' ? '/index' : stripped;
  return `https://${branch}--${repo}--${owner}.aem.page${segment}.plain.html`;
}
