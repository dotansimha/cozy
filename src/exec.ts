import { CancelFn, CozyCommandDefinition, CozyExecutableCommand, LoggerFn } from './types';
import { spawn, execSync, ChildProcessWithoutNullStreams } from 'child_process';
import * as kill from 'tree-kill';
import { resolve } from 'path';
import execa = require('execa');
import * as chalk from 'chalk';
import pidusage = require('pidusage');

export function createCommand(rootCwd: string, name: string, commandDefinition: CozyCommandDefinition): CozyExecutableCommand {
  let logHandler: LoggerFn | null = null;
  let child: ChildProcessWithoutNullStreams | null = null;
  let duringKill = false;
  let retryCount = 0;

  const execDir = resolve(rootCwd, commandDefinition.dir || './');
  const rootScript = commandDefinition.npm ? 'yarn' : commandDefinition.exec!;
  const rawArgs = commandDefinition.args || [];
  const args = commandDefinition.npm ? [commandDefinition.npm, ...rawArgs] : rawArgs;
  const niceName = commandDefinition.script ? commandDefinition.script : `${rootScript} ${args.join(' ')} ("${commandDefinition.dir || './'}")`;

  if (!rootScript && !commandDefinition.script) {
    throw new Error(`Command "${name}" doesn't have an executable defined!`);
  }

  const stopFn: CancelFn = async () => {
    if (child !== null) {
      try {
        child.stderr.destroy();
      } catch (e) {}
      try {
        child.stdin.destroy();
      } catch (e) {}
      try {
        child.stdout.destroy();
      } catch (e) {}

      await new Promise(resolve => kill(child!.pid, 'SIGKILL', resolve));

      child = null;
    }
  };

  const log = (line: string) => {
    if (logHandler) {
      logHandler(line);
    }
  };

  const internalLogger = (line: string) => {
    if (logHandler) {
      logHandler(`\n===== ${line} =====\n`);
    }
  };

  const runFn = async (options: { restartWhenFails: boolean; retryCount: number }) => {
    if (child) {
      await stopFn();
    }

    child = spawn(rootScript, args, {
      cwd: execDir
    });

    child.on('close', code => {
      internalLogger(`Command "${niceName}" exited with code ${code}.`);

      stopFn().then(() => {
        if (duringKill) {
          return;
        }

        if (code !== 0 && options.restartWhenFails) {
          if (retryCount < options.retryCount) {
            internalLogger(chalk.yellow`Starting command "${niceName}" again (attempt: ${retryCount + 1}/${options.retryCount}) `);

            retryCount = retryCount + 1;
            runFn(options);
          } else {
            internalLogger(chalk.red`Command "${niceName}" failed too many times (${options.retryCount}). Please make sure it's valid!`);
          }
        }
      });
    });

    if (logHandler) {
      child.stdout.on('data', data => {
        log(data.toString());
      });

      child.stderr.on('data', data => {
        log(data.toString());
      });
    }
  };

  return {
    source: commandDefinition,
    name,
    prettyName: niceName,
    trackLog: handler => {
      logHandler = handler;
    },
    runWithLogs: handler => {
      if (commandDefinition.script) {
        const log = execSync(commandDefinition.script).toString();
        handler(log);
      } else {
        const tempChild = spawn(rootScript, args, {
          cwd: execDir
        });

        tempChild.stdout.on('data', data => {
          handler(data.toString());
        });

        tempChild.stderr.on('data', data => {
          handler(data.toString());
        });

        tempChild.on('close', () => {
          kill(tempChild.pid);
          handler(`Done!`);
        });
      }

      return;
    },
    run: () => {
      if (commandDefinition.script) {
        return execSync(commandDefinition.script).toString();
      }

      return execa(rootScript, args, { cwd: execDir });
    },
    start: () => {
      internalLogger(chalk.blue`Running "${niceName}"...`);

      runFn({
        restartWhenFails: true,
        retryCount: 3
      });
    },
    stop: async () => {
      duringKill = true;
      internalLogger(chalk.blue`Stopping "${niceName}"...`);
      await stopFn();
    },
    restart: () => {
      retryCount = 0;
      internalLogger(chalk.yellow`Restarting "${niceName}"...`);

      if (child && child.exitCode !== null && child.exitCode === 0) {
        runFn({
          restartWhenFails: true,
          retryCount: 3
        });
      } else {
        stopFn();
      }
    },
    probe: async () => {
      if (!child) {
        return { running: false };
      } else if ((child && child.killed) || child.exitCode) {
        return { running: false };
      } else {
        return { running: true };
      }
    }
  };
}
