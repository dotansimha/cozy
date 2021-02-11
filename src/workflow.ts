import { CozyExecutableCommand, CozyWorkflow } from './types';
import { Listr } from 'listr2';
import * as chalk from 'chalk';
import * as blessed from 'blessed';
import * as contrib from 'blessed-contrib';

function namedCommand(parsedCommands: CozyExecutableCommand[], name: string) {
  const parsedCommand = parsedCommands.find(c => c.name === name);

  if (!parsedCommand) {
    throw new Error(`Unable to find command named "${name}"!`);
  }

  return parsedCommand;
}

export async function runSequence(workflow: CozyWorkflow, parsedCommands: CozyExecutableCommand[]): Promise<void> {
  const list = new Listr(
    workflow.commands.map(name => {
      const parsedCommand = namedCommand(parsedCommands, name);

      return {
        title: chalk`{bold ${name}} (${parsedCommand.prettyName})`,
        task: () => parsedCommand.run()
      };
    })
  );

  return list.run();
}

export async function runParallel(workflow: CozyWorkflow, parsedCommands: CozyExecutableCommand[]): Promise<void> {
  const loggers: blessed.Widgets.Log[] = [];
  let currentCpIndex: number = 0;
  let currentScriptIndex: number = 0;
  let probeInterval: any = null;

  const screen = blessed.screen({
    fastCSR: true,
    smartCSR: true
  });

  const stopAll = async (e?: Error) => {
    if (probeInterval) {
      clearInterval(probeInterval);
      probeInterval = null;
    }

    if (e) {
      console.error(e);
    }

    for (const commandName of workflow.commands) {
      const parsedCommand = namedCommand(parsedCommands, commandName);

      if (parsedCommand) {
        try {
          await parsedCommand.stop();
        } catch (e) {}
      }
    }

    setTimeout(() => {
      screen.destroy();
      process.exit(0);
    }, 2000);
  };

  screen.key(['escape', 'q', 'C-c'], stopAll);
  process.on('SIGINT', stopAll);
  process.on('SIGTERM', stopAll);
  process.on('uncaughtException', stopAll);
  process.on('uncaughtExceptionMonitor', stopAll);
  process.on('unhandledRejection', stopAll);

  screen.key(['r'], () => {
    if (workflow.commands[currentCpIndex]) {
      const parsedCommand = namedCommand(parsedCommands, workflow.commands[currentCpIndex]);
      parsedCommand.restart();
    }
  });

  const grid = new contrib.grid({
    rows: 12,
    cols: 12,
    screen
  });

  const commandSpecificLogger: blessed.Widgets.Log = grid.set(0, 0, 12, 12, blessed.log, {
    scrollable: true,
    name: 'globalLog',
    hidden: true,
    keys: true,
    mouse: true,
    label: ' Log ',
    style: {
      border: {
        fg: 'white'
      }
    }
  });

  const commands: blessed.Widgets.ListElement = grid.set(0, 9, 12, 3, blessed.list, {
    name: 'commands',
    tags: true,
    autoCommandKeys: true,
    keys: true,
    mouse: false,
    label: ' All Scripts ',
    style: {
      border: {
        fg: 'white'
      },
      selected: {
        bg: 'blue',
        fg: 'white'
      }
    }
  });

  for (const cmd of parsedCommands) {
    commands.add(cmd.name);
  }

  const list: blessed.Widgets.ListElement = grid.set(0, 0, 12, 2, blessed.list, {
    name: 'processes',
    tags: true,
    autoCommandKeys: true,
    keys: true,
    mouse: false,
    label: ' Running Processes ',
    style: {
      border: {
        fg: 'blue'
      },
      selected: {
        bg: 'blue',
        fg: 'white'
      }
    }
  });

  const logBox = grid.set(0, 2, 12, 7, blessed.box, {
    label: ' Logs ',
    name: 'logs-parent',
    content: '',
    keys: false,
    mouse: false,
    style: {
      border: {
        fg: 'white'
      }
    }
  });

  screen.key(['enter', 'space'], () => {
    if (screen.focused.name === commandSpecificLogger.name) {
      commandSpecificLogger.hidden = true;

      setTimeout(() => {
        commands.focus();
        screen.render();
      }, 50);
    }

    if (screen.focused.name === commands.name) {
      commandSpecificLogger.hidden = false;
      commandSpecificLogger.focus();
      commandSpecificLogger.content = '';
      screen.render();

      if (parsedCommands[currentScriptIndex]) {
        parsedCommands[currentScriptIndex].runWithLogs(line => commandSpecificLogger.log(line));
      }
    }
  });

  commands.on('select item', (item: any, index: number) => {
    currentScriptIndex = index;
  });

  screen.key(['left', 'right'], (ch, key) => {
    const focusOnLog = () => {
      loggers[currentCpIndex] && loggers[currentCpIndex].focus();
      logBox.style.border.fg = 'blue';
      list.style.border.fg = 'white';
      commands.style.border.fg = 'white';
    };

    const focusOnProcesses = () => {
      list.focus();
      list.style.border.fg = 'blue';
      logBox.style.border.fg = 'white';
      commands.style.border.fg = 'white';
    };

    const focusOnAllCommands = () => {
      commands.focus();
      commands.style.border.fg = 'blue';
      logBox.style.border.fg = 'white';
      list.style.border.fg = 'white';
    };

    if (key.name === 'left') {
      if (screen.focused.name === commands.name) {
        focusOnLog();
      } else if (screen.focused.name === 'log') {
        focusOnProcesses();
      }
    } else if (key.name === 'right') {
      if (screen.focused.name === list.name) {
        focusOnLog();
      } else if (screen.focused.name === 'log') {
        focusOnAllCommands();
      }
    }

    screen.render();
  });

  const setProcess = (index: number) => {
    if (loggers[currentCpIndex]) {
      loggers[currentCpIndex].hidden = true;
    }

    currentCpIndex = index;
    if (loggers[index]) {
      loggers[index].hidden = false;
    }
  };

  list.on('select item', (item: any, index: number) => {
    setProcess(index);
  });

  const monitorProceeses = async () => {
    for (const [index, commandName] of workflow.commands.entries()) {
      const parsedCommand = namedCommand(parsedCommands, commandName);
      const item = list.getItem(index);

      if (parsedCommand && item) {
        try {
          const probeResult = await parsedCommand.probe();

          if (probeResult.running) {
            item.style.fg = 'green';
          } else {
            item.style.fg = 'red';
          }
        } catch (e) {
          item.style.fg = 'red';
        }
      }
    }
  };

  for (const name of workflow.commands) {
    const parsedCommand = namedCommand(parsedCommands, name);
    list.add(parsedCommand.name);

    const log = blessed.log({
      scrollable: true,
      name: 'log',
      hidden: true,
      keys: true,
      mouse: true
    });
    loggers.push(log);
    logBox.append(log);

    parsedCommand.trackLog(line => log.log(line));
    parsedCommand.start();
  }

  setProcess(0);
  list.focus();
  screen.append(commandSpecificLogger);
  screen.render();

  probeInterval = setInterval(monitorProceeses, 3000);
}

// const execa = require('execa');
// const { resolve } = require('path');
// const { devScripts = {} } = require('../../../package.json');
// const { spawn } = require('child_process');
// const pidusage = require('pidusage');
// const kill = require('tree-kill');

// const arg = process.argv[2] || '';
// const quick = arg === 'quick' || arg === 'q';

// const basedir = __dirname;

// function displayMonitor() {
//   for (const service of devScripts.concurrent) {
//     const scriptCwd = resolve(basedir, service.dir);
//     const serviceName = service.dir;
//     const args = Array.isArray(service.script) ? service.script : service.script.split(' ');
//     list.add(serviceName);

//     const log = blessed.log({
//       scrollable: true,
//       hidden: true,
//       keys: true,
//       mouse: true
//     });
//     loggers.push(log);
//     logBox.append(log);

//     startCp(log, args, scriptCwd);
//   }

//   let currentCpIndex = 0;

//   const monitorProcesses = () => {
//     processes.forEach((p, index) => {
//       pidusage(p.pid, err => {
//         const item = list.getItem(index);

//         if (item) {
//           if (err) {
//             item.style.fg = 'red';
//           } else {
//             item.style.fg = 'green';
//           }
//         }
//       });
//     });
//   };

//   const setProcess = index => {
//     loggers[currentCpIndex].hidden = true;
//     currentCpIndex = index;
//     loggers[index].hidden = false;
//   };

//   interval = setInterval(monitorProcesses, 5000);

//   list.on('select item', (item, index) => {
//     setProcess(index);
//   });

//   setProcess(0);
//   list.focus();

//   screen.render();
// }
