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

/* eslint-env mocha */
import assert from 'assert';
import preview from '../src/da/preview.js';
import publish from '../src/da/publish.js';
import deploy from '../src/da/deploy.js';
import auth from '../src/da/auth.js';
import route, { classifyRoute } from '../src/da/route.js';
import {
  guardCommit,
  liveUrl,
  previewUrl,
} from '../src/da/shared.js';

function commandRecorder() {
  const registered = [];
  const chainable = {
    command: (cmd) => {
      registered.push(cmd);
      return chainable;
    },
    demandCommand: () => chainable,
    help: () => chainable,
  };
  return { registered, chainable };
}

describe('da preview command', () => {
  it('registers preview subcommands', () => {
    const cmd = preview();
    const { registered, chainable } = commandRecorder();
    cmd.builder(chainable);
    assert.deepStrictEqual(
      registered.map((sub) => sub.command),
      ['page <path>', 'tree [prefix]', 'status <path>'],
    );
  });
});

describe('da auth command', () => {
  it('registers auth subcommands', () => {
    const cmd = auth();
    const { registered, chainable } = commandRecorder();
    cmd.builder(chainable);
    assert.deepStrictEqual(
      registered.map((sub) => sub.command),
      ['login', 'logout', 'status', 'token'],
    );
  });
});

describe('da publish command', () => {
  it('registers publish subcommands', () => {
    const cmd = publish();
    const { registered, chainable } = commandRecorder();
    cmd.builder(chainable);
    assert.deepStrictEqual(
      registered.map((sub) => sub.command),
      ['page <path>', 'tree [prefix]', 'unpublish <path>'],
    );
  });
});

describe('da deploy command', () => {
  it('registers deploy subcommands', () => {
    const cmd = deploy();
    const { registered, chainable } = commandRecorder();
    cmd.builder(chainable);
    assert.deepStrictEqual(registered.map((sub) => sub.command), ['page <path>']);
  });
});

describe('da route command', () => {
  it('registers route subcommands', () => {
    const cmd = route();
    const { registered, chainable } = commandRecorder();
    cmd.builder(chainable);
    assert.deepStrictEqual(
      registered.map((sub) => sub.command),
      ['classify <path>', 'canonical <path>', 'audit [prefix]'],
    );
  });

  it('classifies DA-backed routes as contentbus', async () => {
    const ctx = {
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      daClient: { getSource: async () => ({ ok: true }) },
      helixClient: {
        previewStatus: async () => ({
          preview: { status: 200, sourceLocation: 'https://content.da.live/owner/repo/index.html' },
        }),
      },
    };
    const result = await classifyRoute(ctx, '/index');
    assert.strictEqual(result.ownership, 'contentbus');
    assert.strictEqual(result.sourcePath, '/index.html');
  });

  it('classifies code-backed routes as codebus', async () => {
    const ctx = {
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      daClient: { getSource: async () => null },
      helixClient: {
        previewStatus: async () => ({
          preview: { status: 200, sourceLocation: 'https://github.com/owner/repo/index.html' },
        }),
      },
    };
    const result = await classifyRoute(ctx, '/index');
    assert.strictEqual(result.ownership, 'codebus');
  });
});

describe('da shared helpers', () => {
  it('builds canonical preview and live urls', () => {
    assert.strictEqual(
      previewUrl('owner', 'repo', 'main', '/index.html'),
      'https://main--repo--owner.aem.page/',
    );
    assert.strictEqual(
      liveUrl('owner', 'repo', 'main', '/blog/index.html'),
      'https://main--repo--owner.aem.live/blog/',
    );
  });

  it('requires commit unless dry-run is explicitly overridden', () => {
    const messages = [];
    const log = { info: (msg) => messages.push(msg) };
    assert.strictEqual(guardCommit({ commit: false }, log, 'Publish /index'), false);
    assert.ok(messages.some((msg) => msg.includes('[dry-run] Publish /index')));
    assert.strictEqual(guardCommit({ commit: true }, log, 'Publish /index'), true);
    assert.strictEqual(guardCommit({ commit: true, dryRun: true }, log, 'Publish /index'), false);
  });
});
