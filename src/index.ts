import { Command, flags } from '@oclif/command';
import { resolve } from 'path';
import { CozyConfig } from './types';
import { createCommand } from './exec';
import { runSequence, runParallel } from './workflow';

class Cozy extends Command {
  static description = 'describe the command here';

  static flags = {
    version: flags.version({ char: 'v' }),
    help: flags.help({ char: 'h' })
  };

  static args = [{ name: 'workflow' }];

  async run() {
    const packageJson = require(resolve(process.cwd(), './package.json'));
    const config: CozyConfig = packageJson.cozy || { workflows: {}, commands: {} };
    const { args } = this.parse(Cozy);

    if (!args.workflow) {
      this.error(`Missing workflow name!`);
    } else {
      const workflow = config.workflows[args.workflow];

      if (!workflow) {
        this.error(`Workflow "${args.workflow}" does not exists!`);
      } else {
        this.log(`Starting workflow "${args.workflow}" from directory: "${process.cwd()}"...`);
        const parsedCommands = Object.keys(config.commands).map(name => createCommand(process.cwd(), name, config.commands[name]));

        try {
          if (!workflow.parallel) {
            await runSequence(workflow, parsedCommands);
          } else {
            await runParallel(workflow, parsedCommands);
          }
        } catch (e) {
          this.error(e);
        }
      }
    }
  }
}

export = Cozy;
