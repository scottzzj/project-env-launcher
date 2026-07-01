import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMavenStartCommand, mergeMavenDependencyBuildSteps } from './maven-utils.js';

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

test('buildMavenStartCommand cleans reactor modules before install', () => {
  const command = buildMavenStartCommand(project, moduleConfig, environment, ports, mavenRuntime);

  assert.match(command.command, /-Dmaven\.source\.skip=true/);
  assert.match(command.command, /-T 1C -pl trade-gateway -am clean install && mvn\.cmd/);
});

test('buildMavenStartCommand can skip dependency build after a shared batch build', () => {
  const command = buildMavenStartCommand(project, moduleConfig, environment, ports, mavenRuntime, null, {
    skipDependencyBuild: true,
  });

  assert.doesNotMatch(command.command, /clean install/);
  assert.doesNotMatch(command.command, /&& mvn\.cmd/);
  assert.doesNotMatch(command.command, /-T 1C/);
  assert.match(command.command, /mvn\.cmd -ntp .* -f=D:[/\\]repo[/\\]trade-gateway[/\\]pom\.xml spring-boot:run/);
});

test('buildMavenStartCommand exposes dependency build step for batch startup', () => {
  const command = buildMavenStartCommand(project, moduleConfig, environment, ports, mavenRuntime);

  assert.equal(command.dependencyBuildStep.cwd, 'D:/repo');
  assert.match(command.dependencyBuildStep.command, /mvn\.cmd -ntp .* -T 1C -pl trade-gateway -am clean install/);
  assert.ok(command.dependencyBuildStep.args.includes('-Dmaven.source.skip=true'));
  assert.deepEqual(command.dependencyBuildStep.args.slice(-7), ['-T', '1C', '-pl', 'trade-gateway', '-am', 'clean', 'install']);
});

test('mergeMavenDependencyBuildSteps combines module selectors for one shared clean install', () => {
  const gatewayCommand = buildMavenStartCommand(project, moduleConfig, environment, ports, mavenRuntime);
  const adminCommand = buildMavenStartCommand(
    project,
    { path: 'trade-admin' },
    environment,
    ports,
    {
      ...mavenRuntime,
      cwd: 'D:/repo/trade-admin',
      commandModuleSelector: 'trade-admin',
    },
  );

  const mergedStep = mergeMavenDependencyBuildSteps([
    gatewayCommand.dependencyBuildStep,
    adminCommand.dependencyBuildStep,
  ]);

  assert.equal(mergedStep.cwd, 'D:/repo');
  assert.match(mergedStep.command, /-pl trade-gateway,trade-admin -am clean install/);
  assert.deepEqual(mergedStep.moduleSelectors, ['trade-gateway', 'trade-admin']);
});

test('buildMavenStartCommand cleans root Maven project when no module selector exists', () => {
  const command = buildMavenStartCommand(
    project,
    { path: '' },
    environment,
    ports,
    {
      ...mavenRuntime,
      cwd: 'D:/repo',
      commandModuleSelector: '',
    },
  );

  assert.match(command.command, /mvn\.cmd -ntp .* -T 1C clean install && mvn\.cmd/);
  assert.doesNotMatch(command.dependencyBuildStep.command, /-pl/);
  assert.deepEqual(command.dependencyBuildStep.args.slice(-4), ['-T', '1C', 'clean', 'install']);
  assert.equal(command.dependencyBuildStep.buildsProjectRoot, true);
});

test('mergeMavenDependencyBuildSteps rejects different Maven build contexts', () => {
  const gatewayCommand = buildMavenStartCommand(project, moduleConfig, environment, ports, mavenRuntime);
  const otherCommand = buildMavenStartCommand(
    { path: 'D:/other-repo' },
    { path: 'trade-admin' },
    environment,
    ports,
    {
      ...mavenRuntime,
      cwd: 'D:/other-repo/trade-admin',
      commandRoot: 'D:/other-repo',
      commandModuleSelector: 'trade-admin',
    },
  );

  const mergedStep = mergeMavenDependencyBuildSteps([
    gatewayCommand.dependencyBuildStep,
    otherCommand.dependencyBuildStep,
  ]);

  assert.equal(mergedStep, null);
});

test('dependency build lock is shared by Maven local repository across project copies', () => {
  const firstCommand = buildMavenStartCommand(project, moduleConfig, environment, ports, mavenRuntime);
  const secondCommand = buildMavenStartCommand(
    { path: 'D:/repo-copy' },
    { path: 'trade-gateway' },
    environment,
    ports,
    {
      ...mavenRuntime,
      cwd: 'D:/repo-copy/trade-gateway',
      commandRoot: 'D:/repo-copy',
      commandModuleSelector: 'trade-gateway',
    },
  );
  const isolatedCommand = buildMavenStartCommand(
    { path: 'D:/repo-isolated' },
    { path: 'trade-gateway' },
    environment,
    ports,
    {
      ...mavenRuntime,
      cwd: 'D:/repo-isolated/trade-gateway',
      commandRoot: 'D:/repo-isolated',
      commandModuleSelector: 'trade-gateway',
      localRepository: 'D:/m2-isolated',
    },
  );

  assert.equal(firstCommand.dependencyBuildStep.lockKey, secondCommand.dependencyBuildStep.lockKey);
  assert.notEqual(firstCommand.dependencyBuildStep.lockKey, isolatedCommand.dependencyBuildStep.lockKey);
});
