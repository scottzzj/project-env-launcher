import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRuntimeOverrideYaml,
  getYamlScalarValue,
  mergeYamlConfigContents,
  sanitizeProfileSpecificConfigContent,
  selectEnvironmentProfileConfigNames,
} from './environment-config-utils.js';

test('buildRuntimeOverrideYaml keeps full YAML and applies runtime overrides', () => {
  const content = [
    'server:',
    '  port: 8681',
    'spring:',
    '  datasource:',
    '    trade:',
    '      url: jdbc:mysql://ob-proxy.read.epean.cn:2883/trade_online',
    'img:',
    '  ftp:',
    '    host: 192.168.0.64',
    '    port: 21',
    '',
  ].join('\n');

  const runtimeYaml = buildRuntimeOverrideYaml(content, { server: 18681 });

  assert.match(runtimeYaml, /host: 192\.168\.0\.64/);
  assert.match(runtimeYaml, /url: jdbc:mysql:\/\/ob-proxy\.read\.epean\.cn:2883\/trade_online/);
  assert.match(runtimeYaml, /port: 18681/);
  assert.match(runtimeYaml, /register-enabled: false/);
});

test('selectEnvironmentProfileConfigNames only includes the requested profile and dev fallback', () => {
  const files = [
    'application-dev.yml',
    'application-test.yml',
    'application-ep.yml',
    'application-mx.yml',
  ];
  const baseContent = [
    'spring:',
    '  profiles:',
    '    active: dev,test',
  ].join('\n');

  assert.deepEqual(selectEnvironmentProfileConfigNames(files, baseContent, 'dev'), ['application-dev.yml']);
  assert.deepEqual(selectEnvironmentProfileConfigNames(files, baseContent, 'ep'), [
    'application-ep.yml',
    'application-dev.yml',
  ]);
  assert.deepEqual(selectEnvironmentProfileConfigNames(files, baseContent, 'mx'), [
    'application-mx.yml',
    'application-dev.yml',
  ]);
  assert.deepEqual(
    selectEnvironmentProfileConfigNames(['application-dev.yml', 'application-test.yml'], baseContent, 'ep'),
    ['application-dev.yml'],
  );
});

test('mergeYamlConfigContents recursively merges profile values without duplicate scalar paths', () => {
  const baseContent = [
    'spring:',
    '  cloud:',
    '    nacos:',
    '      discovery:',
    '        server-addr: 192.168.0.155:8848',
    '      config:',
    '        server-addr: 192.168.0.155:8848',
    '  config:',
    '    import:',
    '      - optional:nacos:trade-lms.yaml?group=DEFAULT_GROUP',
    'server:',
    '  port: 8681',
  ].join('\n');
  const profileContent = [
    'spring:',
    '  cloud:',
    '    nacos:',
    '      discovery:',
    '        server-addr: 192.168.0.200:8848',
    '        namespace: zzj',
    'server:',
    '  servlet:',
    '    context-path: /lms',
  ].join('\n');

  const mergedContent = mergeYamlConfigContents([baseContent, profileContent]);

  assert.equal(
    getYamlScalarValue(mergedContent, ['spring', 'cloud', 'nacos', 'discovery', 'server-addr']),
    '192.168.0.200:8848',
  );
  assert.equal(getYamlScalarValue(mergedContent, ['spring', 'cloud', 'nacos', 'discovery', 'namespace']), 'zzj');
  assert.equal(getYamlScalarValue(mergedContent, ['server', 'port']), '8681');
  assert.equal(getYamlScalarValue(mergedContent, ['server', 'servlet', 'context-path']), '/lms');
  assert.equal((mergedContent.match(/server-addr:/g) ?? []).length, 2);
  assert.match(mergedContent, /- optional:nacos:trade-lms\.yaml\?group=DEFAULT_GROUP/);
});

test('mergeYamlConfigContents removes profile activation from generated profile YAML', () => {
  const mergedContent = mergeYamlConfigContents([
    [
      'spring:',
      '  application:',
      '    name: trade-lms',
      '  profiles:',
      '    active: dev',
      '  cloud:',
      '    nacos:',
      '      discovery:',
      '        namespace: zzj',
    ].join('\n'),
    [
      'server:',
      '  servlet:',
      '    context-path: /lms',
    ].join('\n'),
  ]);

  assert.equal(getYamlScalarValue(mergedContent, ['spring', 'profiles', 'active']), '');
  assert.doesNotMatch(mergedContent, /profiles:\s*\n\s*active:/);
  assert.equal(getYamlScalarValue(mergedContent, ['spring', 'application', 'name']), 'trade-lms');
});

test('buildRuntimeOverrideYaml removes stale profile activation from saved YAML', () => {
  const savedContent = [
    'spring:',
    '  profiles:',
    '    active: dev',
    '  datasource:',
    '    trade:',
    '      username: itob_query@epean#oa',
    'img:',
    '  ftp:',
    '    host: 192.168.0.64',
    'server:',
    '  port: 8681',
  ].join('\n');

  const runtimeYaml = buildRuntimeOverrideYaml(savedContent, { server: 18681 });

  assert.equal(getYamlScalarValue(runtimeYaml, ['spring', 'profiles', 'active']), '');
  assert.doesNotMatch(runtimeYaml, /profiles:\s*\n\s*active:/);
  assert.match(runtimeYaml, /username: itob_query@epean#oa/);
  assert.match(runtimeYaml, /host: 192\.168\.0\.64/);
  assert.equal(getYamlScalarValue(runtimeYaml, ['server', 'port']), '18681');
});

test('sanitizeProfileSpecificConfigContent removes dotted and properties profile activation', () => {
  const sanitizedContent = sanitizeProfileSpecificConfigContent([
    'spring.profiles.active: dev',
    'spring.profiles.active=dev',
    'spring:',
    '  application:',
    '    name: trade-lms',
  ].join('\n'));

  assert.doesNotMatch(sanitizedContent, /spring\.profiles\.active/);
  assert.equal(getYamlScalarValue(sanitizedContent, ['spring', 'application', 'name']), 'trade-lms');
});
