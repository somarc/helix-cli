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
import fse from 'fs-extra';
import up from '../src/up.js';
import hack from '../src/hack.js';
import importCmd from '../src/import.js';
import content from '../src/content/content.js';
import auth from '../src/da/auth.js';
import preview from '../src/da/preview.js';
import publish from '../src/da/publish.js';
import deploy from '../src/da/deploy.js';
import route from '../src/da/route.js';
import index from '../src/da/index.js';
import code from '../src/da/code.js';

const COMMAND_FACTORIES = [
  up,
  hack,
  importCmd,
  content,
  auth,
  preview,
  publish,
  deploy,
  route,
  index,
  code,
];

function commandRecorder() {
  const registered = [];
  const chainable = {
    command: (cmd) => {
      registered.push(cmd);
      return chainable;
    },
    demandCommand: () => chainable,
    help: () => chainable,
    option: () => chainable,
    options: () => chainable,
    positional: () => chainable,
    check: () => chainable,
    conflicts: () => chainable,
    example: () => chainable,
    group: () => chainable,
    implies: () => chainable,
  };
  return { registered, chainable };
}

function collectSubcommands(cmd) {
  if (!cmd.builder) {
    return [];
  }
  const { registered, chainable } = commandRecorder();
  cmd.builder(chainable);
  return registered.map((sub) => ({
    command: sub.command,
    subcommands: collectSubcommands(sub),
  }));
}

function flattenSurface() {
  return COMMAND_FACTORIES.map((factory) => {
    const cmd = factory();
    return {
      command: cmd.command,
      subcommands: collectSubcommands(cmd),
    };
  });
}

function documentedNestedSubcommands(doc) {
  return Object.entries(doc.nestedSubcommands || {})
    .map(([command, subcommands]) => ({
      command,
      subcommands: subcommands.map((sub) => ({ command: sub, subcommands: [] })),
    }));
}

describe('cli surface documentation', () => {
  it('matches the registered top-level commands and subcommands', async () => {
    const docs = await fse.readJson('docs/cli-surface.json');
    const actual = flattenSurface();

    assert.deepStrictEqual(
      docs.commands.map((cmd) => cmd.command),
      actual.map((cmd) => cmd.command),
    );

    docs.commands.forEach((doc, i) => {
      const actualCommand = actual[i];
      assert.deepStrictEqual(
        doc.subcommands || [],
        actualCommand.subcommands.map((sub) => sub.command),
        doc.command,
      );

      assert.deepStrictEqual(
        documentedNestedSubcommands(doc),
        actualCommand.subcommands
          .filter((sub) => sub.subcommands.length)
          .map((sub) => ({
            command: sub.command,
            subcommands: sub.subcommands,
          })),
        `${doc.command} nested subcommands`,
      );
    });
  });
});
