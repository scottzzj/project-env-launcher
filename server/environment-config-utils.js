import { createHash } from 'node:crypto';

export const SERVER_PORT_PATH = ['server', 'port'];

const ENVIRONMENT_CONFIG_FIELDS = {
  database: {
    title: '数据库',
    paths: {
      url: ['spring', 'datasource', 'url'],
      username: ['spring', 'datasource', 'username'],
      password: ['spring', 'datasource', 'password'],
      driver: ['spring', 'datasource', 'driver-class-name'],
    },
  },
  nacos: {
    title: 'Nacos',
    paths: {
      enabled: ['spring', 'cloud', 'nacos', 'discovery', 'enabled'],
      serverAddr: ['spring', 'cloud', 'nacos', 'discovery', 'server-addr'],
      namespace: ['spring', 'cloud', 'nacos', 'discovery', 'namespace'],
    },
  },
  rabbitmq: {
    title: 'RabbitMQ',
    paths: {
      host: ['spring', 'rabbitmq', 'host'],
      port: ['spring', 'rabbitmq', 'port'],
      username: ['spring', 'rabbitmq', 'username'],
      password: ['spring', 'rabbitmq', 'password'],
      virtualHost: ['spring', 'rabbitmq', 'virtual-host'],
      addresses: ['spring', 'rabbitmq', 'addresses'],
    },
  },
  redis: {
    title: 'Redis',
    paths: {
      database: ['spring', 'data', 'redis', 'database'],
      sentinelMaster: ['spring', 'data', 'redis', 'sentinel', 'master'],
      sentinelNodes: ['spring', 'data', 'redis', 'sentinel', 'nodes'],
      password: ['spring', 'data', 'redis', 'password'],
      redissonHost: ['spring', 'redis', 'redisson', 'host'],
      redissonPort: ['spring', 'redis', 'redisson', 'port'],
    },
  },
  mongodb: {
    title: 'MongoDB',
    paths: {
      uri: ['spring', 'data', 'mongodb', 'uri'],
    },
  },
  rocketmq: {
    title: 'RocketMQ',
    paths: {
      nameServer: ['rocketmq', 'name-server'],
      producerGroup: ['rocketmq', 'producer', 'group'],
      consumerGroup: ['rocketmq', 'consumer', 'group'],
      accessKey: ['rocketmq', 'access-key'],
      secretKey: ['rocketmq', 'secret-key'],
    },
  },
};
const SECRET_FIELD_NAMES = new Set(['password', 'uri', 'accessKey', 'secretKey']);
const DATASOURCE_FIELD_DEFS = [
  { name: 'url', yamlKey: 'url', label: '连接地址' },
  { name: 'username', yamlKey: 'username', label: '用户名' },
  { name: 'password', yamlKey: 'password', label: '密码', secret: true },
  { name: 'driver', yamlKey: 'driver-class-name', label: '驱动' },
];
const COMMON_ENVIRONMENT_CONFIG_GROUPS = [
  {
    groupKey: 'nacos',
    groupTitle: 'Nacos',
    includeWhen: [['spring', 'cloud', 'nacos']],
    fields: [
      {
        name: 'discoveryNamespace',
        label: '注册 Namespace',
        path: ['spring', 'cloud', 'nacos', 'discovery', 'namespace'],
      },
      {
        name: 'discoveryServerAddr',
        label: '注册地址',
        path: ['spring', 'cloud', 'nacos', 'discovery', 'server-addr'],
      },
      {
        name: 'configNamespace',
        label: '配置 Namespace',
        path: ['spring', 'cloud', 'nacos', 'config', 'namespace'],
      },
      {
        name: 'configServerAddr',
        label: '配置地址',
        path: ['spring', 'cloud', 'nacos', 'config', 'server-addr'],
      },
    ],
  },
  {
    groupKey: 'rabbitmq',
    groupTitle: 'RabbitMQ',
    includeWhen: [['spring', 'rabbitmq']],
    fields: [
      { name: 'host', label: '主机', path: ['spring', 'rabbitmq', 'host'] },
      { name: 'port', label: '端口', path: ['spring', 'rabbitmq', 'port'] },
      { name: 'addresses', label: '地址', path: ['spring', 'rabbitmq', 'addresses'] },
      { name: 'username', label: '用户名', path: ['spring', 'rabbitmq', 'username'] },
      { name: 'password', label: '密码', path: ['spring', 'rabbitmq', 'password'], secret: true },
      { name: 'virtualHost', label: 'Virtual Host', path: ['spring', 'rabbitmq', 'virtual-host'] },
    ],
  },
  {
    groupKey: 'redis',
    groupTitle: 'Redis',
    includeWhen: [['spring', 'data', 'redis'], ['spring', 'redis', 'redisson']],
    fields: [
      { name: 'database', label: '库', path: ['spring', 'data', 'redis', 'database'] },
      { name: 'sentinelMaster', label: '哨兵 Master', path: ['spring', 'data', 'redis', 'sentinel', 'master'] },
      { name: 'sentinelNodes', label: '哨兵节点', path: ['spring', 'data', 'redis', 'sentinel', 'nodes'] },
      { name: 'password', label: 'Redis 密码', path: ['spring', 'data', 'redis', 'password'], secret: true },
      { name: 'redissonHost', label: 'Redisson 主机', path: ['spring', 'redis', 'redisson', 'host'] },
      { name: 'redissonPort', label: 'Redisson 端口', path: ['spring', 'redis', 'redisson', 'port'] },
      {
        name: 'redissonPassword',
        label: 'Redisson 密码',
        path: ['spring', 'redis', 'redisson', 'password'],
        secret: true,
      },
    ],
  },
  {
    groupKey: 'rocketmq',
    groupTitle: 'RocketMQ',
    includeWhen: [['rocketmq']],
    fields: [
      { name: 'nameServer', label: 'Name Server', path: ['rocketmq', 'name-server'] },
      { name: 'producerGroup', label: '生产者 Group', path: ['rocketmq', 'producer', 'group'] },
      { name: 'consumerGroup', label: '消费者 Group', path: ['rocketmq', 'consumer', 'group'] },
      { name: 'accessKey', label: 'Access Key', path: ['rocketmq', 'access-key'], secret: true },
      { name: 'secretKey', label: 'Secret Key', path: ['rocketmq', 'secret-key'], secret: true },
    ],
  },
];
const STARTUP_NACOS_ENVIRONMENT_CONFIG_GROUP = {
  groupKey: 'startup-nacos',
  groupTitle: '启动配置',
  fields: [
    {
      name: 'serverPort',
      label: '启动端口',
      path: SERVER_PORT_PATH,
    },
  ],
};

function normalizeRequiredString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function parsePortValue(value) {
  const normalizedValue = String(value ?? '').trim().replace(/^['"]|['"]$/g, '');
  const exactMatch = normalizedValue.match(/^(\d+)$/);
  if (exactMatch) {
    return Number(exactMatch[1]);
  }

  // Spring placeholders such as ${SERVER_PORT:8080} are common in module configs.
  const placeholderMatch = normalizedValue.match(/^\$\{[^}:]+:(\d+)\}$/);
  return placeholderMatch ? Number(placeholderMatch[1]) : null;
}

export function normalizeYamlScalar(value) {
  const trimmedValue = String(value ?? '').trim();
  if (!trimmedValue) {
    return '';
  }

  return trimmedValue.replace(/^['"]|['"]$/g, '');
}

export function getYamlScalar(content, keyPath) {
  const dottedKey = keyPath.join('.');
  const lines = content.split(/\r?\n/);
  const stack = [];
  let matchedValue = '';

  for (const rawLine of lines) {
    const lineWithoutComment = rawLine.replace(/\s+#.*$/, '');
    if (!lineWithoutComment.trim()) {
      continue;
    }

    const match = lineWithoutComment.match(/^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*?)\s*$/);
    if (!match) {
      continue;
    }

    const indent = match[1].length;
    const key = match[2];
    const value = match[3];
    while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const nestedPath = [...stack.map((item) => item.key), key];
    if (nestedPath.join('.') === dottedKey || key === dottedKey) {
      matchedValue = normalizeYamlScalar(value);
    }

    if (!value) {
      stack.push({ indent, key });
    }
  }

  return matchedValue;
}

export function enumerateYamlScalarLines(content) {
  const lines = content.split(/\r?\n/);
  const stack = [];
  const entries = [];

  lines.forEach((rawLine, index) => {
    const lineWithoutComment = rawLine.replace(/\s+#.*$/, '');
    if (!lineWithoutComment.trim()) {
      return;
    }

    const match = lineWithoutComment.match(/^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*?)\s*$/);
    if (!match) {
      return;
    }

    const indent = match[1].length;
    const key = match[2];
    const value = match[3];
    while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const pathParts = [...stack.map((item) => item.key), key];
    entries.push({
      index,
      indent,
      key,
      path: pathParts,
      dottedPath: pathParts.join('.'),
      rawLine,
      rawValue: value,
      value: normalizeYamlScalar(value),
      isParent: !value,
    });

    if (!value) {
      stack.push({ indent, key });
    }
  });

  return entries;
}

export function hasYamlPath(content, keyPath) {
  const dottedPath = keyPath.join('.');
  return enumerateYamlScalarLines(content).some((entry) => entry.dottedPath === dottedPath);
}

export function getYamlScalarValue(content, keyPath) {
  const dottedPath = keyPath.join('.');
  return enumerateYamlScalarLines(content)
    .filter((entry) => entry.dottedPath === dottedPath)
    .at(-1)?.value ?? '';
}

function getYamlMappingEntry(content, keyPath) {
  const dottedPath = keyPath.join('.');
  return enumerateYamlScalarLines(content)
    .filter((entry) => entry.dottedPath === dottedPath && entry.isParent)
    .at(-1);
}

function hasAnyYamlField(content, fieldPaths) {
  return fieldPaths.some((fieldPath) => hasYamlPath(content, fieldPath));
}

function detectDatasourceGroups(content) {
  const entries = enumerateYamlScalarLines(content);
  const datasourceParent = entries.find(
    (entry) => entry.dottedPath === 'spring.datasource' && entry.isParent,
  );
  if (!datasourceParent) {
    return [];
  }

  const directFieldPaths = DATASOURCE_FIELD_DEFS.map((fieldDef) => ['spring', 'datasource', fieldDef.yamlKey]);
  if (hasAnyYamlField(content, directFieldPaths)) {
    return [
      {
        groupKey: 'datasource.default',
        groupTitle: '数据库',
        path: ['spring', 'datasource'],
        fields: DATASOURCE_FIELD_DEFS.map((fieldDef) => ({
          ...fieldDef,
          path: ['spring', 'datasource', fieldDef.yamlKey],
          value: getYamlScalarValue(content, ['spring', 'datasource', fieldDef.yamlKey]),
        })),
      },
    ];
  }

  const nestedKeys = new Set(
    entries
      .filter(
        (entry) =>
          entry.path.length === 3 &&
          entry.path[0] === 'spring' &&
          entry.path[1] === 'datasource' &&
          entry.isParent &&
          hasAnyYamlField(
            content,
            DATASOURCE_FIELD_DEFS.map((fieldDef) => ['spring', 'datasource', entry.key, fieldDef.yamlKey]),
          ),
      )
      .map((entry) => entry.key),
  );

  return Array.from(nestedKeys).map((datasourceName) => ({
    groupKey: `datasource.${datasourceName}`,
    groupTitle: `数据库 · ${datasourceName}`,
    path: ['spring', 'datasource', datasourceName],
    fields: DATASOURCE_FIELD_DEFS.map((fieldDef) => ({
      ...fieldDef,
      path: ['spring', 'datasource', datasourceName, fieldDef.yamlKey],
      value: getYamlScalarValue(content, ['spring', 'datasource', datasourceName, fieldDef.yamlKey]),
    })),
  }));
}

export function buildEditableEnvironmentGroups(content) {
  const detectedServerPort = getYamlScalarValue(content, SERVER_PORT_PATH);
  const datasourceGroups = detectDatasourceGroups(content);
  const commonGroups = COMMON_ENVIRONMENT_CONFIG_GROUPS
    .filter((group) => group.includeWhen.some((pathParts) => hasYamlPath(content, pathParts)))
    .map((group) => ({
      groupKey: group.groupKey,
      groupTitle: group.groupTitle,
      fields: group.fields
        .filter((field) => hasYamlPath(content, field.path))
        .map((field) => ({
          name: field.name,
          label: field.label,
          path: field.path,
          secret: field.secret === true,
          value: getYamlScalarValue(content, field.path),
        })),
    }))
    .filter((group) => group.fields.length > 0);
  const nacosGroup = commonGroups.find((group) => group.groupKey === 'nacos');
  const startupNacosGroup = {
    ...STARTUP_NACOS_ENVIRONMENT_CONFIG_GROUP,
    fields: [
      ...STARTUP_NACOS_ENVIRONMENT_CONFIG_GROUP.fields.map((field) => ({
        ...field,
        value: field.path.join('.') === SERVER_PORT_PATH.join('.')
          ? detectedServerPort
          : getYamlScalarValue(content, field.path),
      })),
      ...(nacosGroup?.fields ?? []),
    ],
  };

  return [startupNacosGroup, ...datasourceGroups, ...commonGroups.filter((group) => group.groupKey !== 'nacos')];
}

function formatYamlScalar(value, originalValue = '') {
  const nextValue = String(value ?? '');
  if (!nextValue) {
    return '';
  }

  const trimmedOriginal = String(originalValue ?? '').trim();
  const quote = trimmedOriginal.startsWith('"') ? '"' : trimmedOriginal.startsWith("'") ? "'" : '';
  if (quote) {
    const escapedValue = quote === '"' ? nextValue.replace(/"/g, '\\"') : nextValue.replace(/'/g, "''");
    return `${quote}${escapedValue}${quote}`;
  }

  return nextValue;
}

function replaceYamlScalarLine(rawLine, nextValue) {
  const match = rawLine.match(/^(\s*[A-Za-z0-9_.-]+\s*:\s*)(.*?)(\s+#.*)?$/);
  if (!match) {
    return rawLine;
  }

  return `${match[1]}${formatYamlScalar(nextValue, match[2])}${match[3] ?? ''}`;
}

function setYamlScalar(content, keyPath, value) {
  const lines = content.split(/\r?\n/);
  const entries = enumerateYamlScalarLines(content);
  const dottedPath = keyPath.join('.');
  const existingEntry = entries.filter((entry) => entry.dottedPath === dottedPath).at(-1);

  if (existingEntry) {
    lines[existingEntry.index] = replaceYamlScalarLine(lines[existingEntry.index], value);
    return lines.join('\n');
  }

  const parentPath = keyPath.slice(0, -1);
  const parentEntry = getYamlMappingEntry(content, parentPath);
  if (!parentEntry) {
    return content;
  }

  let insertLineIndex = parentEntry.index + 1;
  while (insertLineIndex < lines.length) {
    const nextEntry = entries.find((entry) => entry.index === insertLineIndex);
    if (nextEntry && nextEntry.indent <= parentEntry.indent) {
      break;
    }
    insertLineIndex += 1;
  }

  const childIndent = ' '.repeat(parentEntry.indent + 2);
  const key = keyPath[keyPath.length - 1];
  lines.splice(insertLineIndex, 0, `${childIndent}${key}: ${formatYamlScalar(value)}`);
  return lines.join('\n');
}

function appendTopLevelYamlScalar(content, keyPath, value) {
  const normalizedContent = String(content ?? '').replace(/\s*$/, '');
  const appendedBlock = keyPath
    .map((key, index) => {
      const indent = ' '.repeat(index * 2);
      return index === keyPath.length - 1
        ? `${indent}${key}: ${formatYamlScalar(value)}`
        : `${indent}${key}:`;
    })
    .join('\n');
  return normalizedContent ? `${normalizedContent}\n\n${appendedBlock}\n` : `${appendedBlock}\n`;
}

function appendYamlScalarUnderParent(content, parentEntry, remainingPath, value) {
  const lines = content.split(/\r?\n/);
  const entries = enumerateYamlScalarLines(content);
  let insertLineIndex = parentEntry.index + 1;

  while (insertLineIndex < lines.length) {
    const nextEntry = entries.find((entry) => entry.index === insertLineIndex);
    if (nextEntry && nextEntry.indent <= parentEntry.indent) {
      break;
    }
    insertLineIndex += 1;
  }

  const insertedLines = remainingPath.map((key, index) => {
    const indent = ' '.repeat(parentEntry.indent + (index + 1) * 2);
    return index === remainingPath.length - 1
      ? `${indent}${key}: ${formatYamlScalar(value)}`
      : `${indent}${key}:`;
  });
  lines.splice(insertLineIndex, 0, ...insertedLines);
  return lines.join('\n');
}

export function setRequiredYamlScalar(content, keyPath, value) {
  const nextContent = setYamlScalar(content, keyPath, value);
  if (nextContent !== content || hasYamlPath(nextContent, keyPath)) {
    return nextContent;
  }

  for (let parentLength = keyPath.length - 1; parentLength > 0; parentLength -= 1) {
    const parentEntry = getYamlMappingEntry(content, keyPath.slice(0, parentLength));
    if (parentEntry) {
      return appendYamlScalarUnderParent(content, parentEntry, keyPath.slice(parentLength), value);
    }
  }

  return appendTopLevelYamlScalar(content, keyPath, value);
}

function setNestedJsonValue(target, keyPath, value) {
  let cursor = target;
  keyPath.forEach((key, index) => {
    if (index === keyPath.length - 1) {
      cursor[key] = value;
      return;
    }

    if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  });
}

export function collectRuntimeEnvironmentJson(content, ports) {
  const runtimeJson = {};
  const seenPaths = new Set();
  const addScalarProperty = (keyPath) => {
    const value = getYamlScalarValue(content, keyPath);
    if (!String(value ?? '').trim()) {
      return;
    }

    const pathKey = keyPath.join('.');
    if (seenPaths.has(pathKey)) {
      return;
    }

    seenPaths.add(pathKey);
    setNestedJsonValue(runtimeJson, keyPath, value);
  };

  addScalarProperty(SERVER_PORT_PATH);
  for (const group of COMMON_ENVIRONMENT_CONFIG_GROUPS) {
    for (const field of group.fields) {
      addScalarProperty(field.path);
    }
  }
  for (const datasourceGroup of detectDatasourceGroups(content)) {
    for (const field of datasourceGroup.fields) {
      addScalarProperty(field.path);
    }
  }

  if (ports?.server) {
    setNestedJsonValue(runtimeJson, SERVER_PORT_PATH, String(ports.server));
  }
  setNestedJsonValue(runtimeJson, ['spring', 'cloud', 'nacos', 'discovery', 'register-enabled'], 'false');

  return runtimeJson;
}

export function buildRuntimeOverrideYaml(content, ports) {
  const fields = [];
  const addScalarProperty = (keyPath) => {
    const value = getYamlScalarValue(content, keyPath);
    if (!String(value ?? '').trim()) {
      return;
    }

    fields.push({ path: keyPath, value });
  };

  addScalarProperty(SERVER_PORT_PATH);
  for (const group of COMMON_ENVIRONMENT_CONFIG_GROUPS) {
    for (const field of group.fields) {
      addScalarProperty(field.path);
    }
  }
  for (const datasourceGroup of detectDatasourceGroups(content)) {
    for (const field of datasourceGroup.fields) {
      addScalarProperty(field.path);
    }
  }

  const serverPort = ports?.server ? String(ports.server) : getYamlScalarValue(content, SERVER_PORT_PATH);
  const uniqueFields = new Map(fields.map((field) => [field.path.join('.'), field]));
  if (serverPort) {
    uniqueFields.set(SERVER_PORT_PATH.join('.'), {
      path: SERVER_PORT_PATH,
      value: serverPort,
    });
  }
  uniqueFields.set('spring.cloud.nacos.discovery.register-enabled', {
    path: ['spring', 'cloud', 'nacos', 'discovery', 'register-enabled'],
    value: 'false',
  });

  return applyEnvironmentConfigFields('', Array.from(uniqueFields.values()));
}

export function collectSafeRuntimeArguments(ports, runtimeOverride = null) {
  return [
    ...(runtimeOverride?.fileUrl ? [`--spring.config.additional-location=${runtimeOverride.fileUrl}`] : []),
    `--server.port=${ports.server}`,
    '--spring.cloud.nacos.discovery.register-enabled=false',
  ];
}

export function normalizeEditableConfigFields(fields = []) {
  if (!Array.isArray(fields)) {
    return [];
  }

  return fields
    .map((field) => ({
      path: Array.isArray(field.path) ? field.path.map((part) => normalizeRequiredString(part)).filter(Boolean) : [],
      value: typeof field.value === 'string' || typeof field.value === 'number' || typeof field.value === 'boolean'
        ? String(field.value)
        : '',
    }))
    .filter((field) => field.path.length > 0);
}

export function applyEnvironmentConfigFields(content, fields = []) {
  return normalizeEditableConfigFields(fields).reduce(
    (nextContent, field) => setRequiredYamlScalar(nextContent, field.path, field.value),
    content,
  );
}

function maskEnvironmentConfigValue(fieldName, value) {
  if (!value) {
    return '';
  }

  return SECRET_FIELD_NAMES.has(fieldName) ? '已配置' : value;
}

export function summarizeEnvironmentConfig(content) {
  return Object.fromEntries(
    [
      [
        'startup-nacos',
        {
          title: '启动配置',
          values: {
            serverPort: getYamlScalar(content, SERVER_PORT_PATH),
            discoveryNamespace: getYamlScalar(content, ['spring', 'cloud', 'nacos', 'discovery', 'namespace']),
            configNamespace: getYamlScalar(content, ['spring', 'cloud', 'nacos', 'config', 'namespace']),
          },
        },
      ],
      ...Object.entries(ENVIRONMENT_CONFIG_FIELDS).map(([groupKey, groupConfig]) => [
        groupKey,
        {
          title: groupConfig.title,
          values: Object.fromEntries(
            Object.entries(groupConfig.paths).map(([fieldName, keyPath]) => {
              const value = getYamlScalar(content, keyPath);
              return [fieldName, maskEnvironmentConfigValue(fieldName, value)];
            }),
          ),
        },
      ]),
    ],
  );
}

export function getContentHash(content) {
  return createHash('sha256').update(content).digest('hex');
}
