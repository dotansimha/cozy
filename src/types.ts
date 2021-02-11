import { ExecaChildProcess } from 'execa';
import { ChildProcess } from 'child_process';

export type CozyCommandDefinition = {
  dir?: string;
  npm?: string;
  exec?: string;
  script?: string;
  args?: string[];
};

export type ExecStats = {
  running: boolean;
};

export type CancelFn = () => Promise<void>;
export type LoggerFn = (logLine: string) => void;

export type CozyExecutableCommand = {
  source: CozyCommandDefinition;
  name: string;
  prettyName: string;
  trackLog: (handler: LoggerFn) => void;
  run: () => ExecaChildProcess | string;
  runWithLogs: (handler: LoggerFn) => void;
  start: () => void;
  stop: () => Promise<void>;
  restart: () => void;
  probe: () => Promise<ExecStats>;
};

export type CozyWorkflow = {
  commands: string[];
  parallel?: boolean;
};

export type CozyConfig = {
  commands: Record<string, CozyCommandDefinition>;
  workflows: Record<string, CozyWorkflow>;
};
