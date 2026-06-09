import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMavenStartCommand } from './maven-utils.js';

const project = { path: 'D:/repo' };
const moduleConfig = { path: 'trade-gateway' };
const environment = { code: 'dev' };
const ports = { server: 8051 };
const mavenRuntime = {
  cwd: 'D:/repo/trade-gateway',
  commandRoot: 'D:/repo',
  commandModuleSelector: 'trade-gateway',
  commandName: 'mvn.cmd',
  localRepository: 'C:/Users/test/.m2/repository',
};

test('buildMavenStartCommand does not force disable Nacos registration', () => {
  const command = buildMavenStartCommand(project, moduleConfig, environment, ports, mavenRuntime, {
    fileUrl: 'file:///D:/runtime/',
    content: [
      'spring:',
      '  cloud:',
      '    nacos:',
      '      discovery:',
      '        namespace: zzj',
    ].join('\n'),
  });

  assert.doesNotMatch(command.command, /spring\.cloud\.nacos\.discovery\.register-enabled=false/);
});
