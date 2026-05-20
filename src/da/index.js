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
import { IndexConfig } from '@adobe/helix-shared-config';
import { getFetch } from '../fetch-utils.js';
import {
  addProjectOptions,
  createProjectContext,
  printResult,
} from './shared.js';

function addIndexOptions(yargs) {
  return addProjectOptions(yargs)
    .option('file', {
      describe: 'Path to helix-query.yaml. Defaults to searching from the current directory.',
      type: 'string',
    });
}

function addQueryOptions(yargs) {
  return addIndexOptions(yargs)
    .option('env', {
      describe: 'Query preview or live.',
      choices: ['preview', 'live'],
      default: 'live',
    })
    .option('limit', {
      describe: 'Max records to fetch.',
      type: 'number',
      default: 50,
    })
    .option('offset', {
      describe: 'Starting offset.',
      type: 'number',
      default: 0,
    })
    .option('filter', {
      describe: 'Client-side filter as key=value. Repeatable.',
      type: 'string',
      array: true,
      default: [],
    });
}

async function loadIndexConfig(argv) {
  const cwd = argv.file ? path.dirname(path.resolve(argv.file)) : process.cwd();
  const config = await new IndexConfig()
    .withDirectory(cwd)
    .init();
  const errors = config.getErrors();
  if (errors.length) {
    throw new Error(errors.map(({ message }) => message).join('\n'));
  }
  return config;
}

function indexRows(config) {
  return config.indices.map((idx) => ({
    index: idx.name,
    target: idx.target || '/query-index',
    fields: Object.keys(idx.properties || {}).join(', '),
    include: (idx.include || []).join(', ') || '(all)',
  }));
}

function baseUrl(project, env) {
  const domain = env === 'preview' ? 'aem.page' : 'aem.live';
  return `https://${project.branch}--${project.repo}--${project.owner}.${domain}`;
}

function targetJson(target) {
  return target.endsWith('.json') ? target : `${target}.json`;
}

async function fetchJson(url) {
  const res = await getFetch(false)(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return res.json();
}

export default function index() {
  return {
    command: 'index <subcommand>',
    description: 'Inspect and query helix-query.yaml indices',
    builder: (yargs) => {
      yargs
        .command({
          command: 'show',
          description: 'Print configured index definitions and fields.',
          builder: addIndexOptions,
          handler: async (argv) => {
            const config = await loadIndexConfig(argv);
            printResult(indexRows(config));
          },
        })
        .command({
          command: 'validate',
          description: 'Check configured fields against live query-index columns.',
          builder: (cmd) => addIndexOptions(cmd).option('env', {
            describe: 'Validate preview or live.',
            choices: ['preview', 'live'],
            default: 'live',
          }),
          handler: async (argv) => {
            const [project, config] = await Promise.all([
              createProjectContext(argv),
              loadIndexConfig(argv),
            ]);
            const rows = [];
            for (const idx of config.indices) {
              const url = `${baseUrl(project, argv.env)}${targetJson(idx.target || '/query-index')}?limit=1`;
              try {
                // eslint-disable-next-line no-await-in-loop
                const data = await fetchJson(url);
                const liveColumns = data.columns || Object.keys(data.data?.[0] || {});
                const missing = Object.keys(idx.properties || {})
                  .filter((field) => !liveColumns.includes(field));
                rows.push({
                  index: idx.name,
                  target: idx.target || '/query-index',
                  status: missing.length ? 'fields-missing' : 'ok',
                  missing: missing.join(', '),
                  columns: liveColumns.join(', '),
                });
              } catch (e) {
                rows.push({
                  index: idx.name,
                  target: idx.target || '/query-index',
                  status: `error: ${e.message}`,
                  missing: '',
                  columns: '',
                });
              }
            }
            printResult(rows);
            if (rows.some((row) => row.status !== 'ok')) {
              process.exitCode = 1;
            }
          },
        })
        .command({
          command: 'query <name>',
          description: 'Run a query against a configured index.',
          builder: addQueryOptions,
          handler: async (argv) => {
            const [project, config] = await Promise.all([
              createProjectContext(argv),
              loadIndexConfig(argv),
            ]);
            const idx = config.indices.find((item) => item.name === argv.name);
            if (!idx) {
              throw new Error(`Index "${argv.name}" not found.`);
            }
            const url = `${baseUrl(project, argv.env)}${targetJson(idx.target || '/query-index')}`
              + `?limit=${argv.limit}&offset=${argv.offset}`;
            const data = await fetchJson(url);
            let rows = data.data || [];
            for (const kv of argv.filter) {
              const eq = kv.indexOf('=');
              if (eq >= 0) {
                const key = kv.slice(0, eq);
                const value = kv.slice(eq + 1).toLowerCase();
                rows = rows.filter((row) => String(row[key] || '').toLowerCase().includes(value));
              }
            }
            printResult(rows);
          },
        })
        .demandCommand(1, 'You need at least one index subcommand.')
        .help();
    },
    handler: () => {},
  };
}
