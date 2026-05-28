import { ClipboardList, Copy, RefreshCw, Square, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

const ACTIVE_RUN_STATUSES = new Set(['starting', 'running']);

function isActiveRunRecord(record) {
  return ACTIVE_RUN_STATUSES.has(record?.status);
}

function sortRunRecords(records) {
  return [...records].sort((first, second) => {
    const firstActive = isActiveRunRecord(first) ? 0 : 1;
    const secondActive = isActiveRunRecord(second) ? 0 : 1;
    if (firstActive !== secondActive) {
      return firstActive - secondActive;
    }
    return String(second.startedAt ?? '').localeCompare(String(first.startedAt ?? ''), 'zh-CN');
  });
}

function getEnvironmentModulePort(moduleItem, environmentCode) {
  const portValue = moduleItem?.environmentPorts?.[environmentCode];
  const port = typeof portValue === 'object' && portValue !== null ? portValue.port : portValue;
  return Number.isInteger(Number(port)) && Number(port) > 0 ? Number(port) : null;
}

function buildTargetKey(environmentCode, moduleId) {
  return `${environmentCode}:${moduleId}`;
}

function parseTargetKey(targetKey) {
  const separatorIndex = targetKey.lastIndexOf(':');
  if (separatorIndex < 0) {
    return null;
  }

  return {
    environmentCode: targetKey.slice(0, separatorIndex),
    moduleId: targetKey.slice(separatorIndex + 1),
  };
}

function sortEnvironmentsForDetail(environments) {
  return [...environments].sort((first, second) => {
    return String(first.name ?? first.code).localeCompare(String(second.name ?? second.code), 'zh-CN');
  });
}

async function copyTextToClipboard(text) {
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  document.body.appendChild(textArea);
  textArea.select();

  try {
    if (!document.execCommand('copy')) {
      throw new Error('copy failed');
    }
  } finally {
    document.body.removeChild(textArea);
  }
}

function ProjectDetailModal({
  environments,
  modules,
  selectedProject,
  isRefreshing,
  isStarting,
  onClose,
  onCreateRunLogEventSource,
  onRefresh,
  onStartModules,
  onStopModules,
  runRecords,
}) {
  const [selectedTargetKeys, setSelectedTargetKeys] = useState([]);
  const [selectedEnvironmentCodes, setSelectedEnvironmentCodes] = useState([]);
  const [startResult, setStartResult] = useState(null);
  const [stopResult, setStopResult] = useState(null);
  const [startupRecordIds, setStartupRecordIds] = useState([]);
  const [activeProcessId, setActiveProcessId] = useState('');
  const [hasManualEnvironmentSelection, setHasManualEnvironmentSelection] = useState(false);
  const [liveLogs, setLiveLogs] = useState({});
  const [liveRecords, setLiveRecords] = useState({});
  const [isLogPinned, setIsLogPinned] = useState(true);
  const [stoppingRecordId, setStoppingRecordId] = useState('');
  const [copyLogStatus, setCopyLogStatus] = useState('idle');
  const logRef = useRef(null);
  const activeProject = selectedProject;
  const orderedEnvironments = useMemo(
    () => sortEnvironmentsForDetail(environments),
    [environments],
  );
  const runtimeModuleById = useMemo(
    () => new Map((activeProject?.runtime?.modules ?? []).map((moduleItem) => [moduleItem.id, moduleItem])),
    [activeProject?.runtime?.modules],
  );
  const activeProjectModules = useMemo(
    () =>
      modules.filter((moduleItem) => {
        if (!moduleItem.projectIds?.includes(activeProject?.id) || moduleItem.hasChildren) {
          return false;
        }

        const runtimeModule = runtimeModuleById.get(moduleItem.id) ?? moduleItem;
        return orderedEnvironments.some((environment) => getEnvironmentModulePort(runtimeModule, environment.code));
      }),
    [activeProject?.id, modules, orderedEnvironments, runtimeModuleById],
  );
  const activeProjectRunRecords = useMemo(
    () => runRecords.filter((record) => record.projectId === activeProject?.id),
    [activeProject?.id, runRecords],
  );
  const activeProjectEnvironmentCode = useMemo(() => {
    const activeRecord = sortRunRecords(activeProjectRunRecords).find(isActiveRunRecord);
    return activeRecord?.environmentCode ?? '';
  }, [activeProjectRunRecords]);
  const defaultEnvironmentCode = useMemo(() => {
    const activeEnvironment = orderedEnvironments.find(
      (environment) => environment.code === activeProjectEnvironmentCode,
    );
    return activeEnvironment?.code ?? orderedEnvironments[0]?.code ?? '';
  }, [activeProjectEnvironmentCode, orderedEnvironments]);

  const selectedEnvironments = useMemo(() => {
    const selected = orderedEnvironments.filter((environment) => selectedEnvironmentCodes.includes(environment.code));
    return selected;
  }, [orderedEnvironments, selectedEnvironmentCodes]);
  const selectedEnvironmentCodeSet = useMemo(
    () => new Set(selectedEnvironments.map((environment) => environment.code)),
    [selectedEnvironments],
  );
  const getModulePortForEnvironment = (moduleItem, environmentCode) =>
    getEnvironmentModulePort(runtimeModuleById.get(moduleItem.id) ?? moduleItem, environmentCode);
  const environmentModuleGroups = useMemo(
    () =>
      selectedEnvironments.map((environment) => ({
        environment,
        modules: activeProjectModules.filter((moduleItem) =>
          getModulePortForEnvironment(moduleItem, environment.code),
        ),
      })),
    [activeProjectModules, runtimeModuleById, selectedEnvironments],
  );
  const configuredProjectModuleCount = environmentModuleGroups.reduce(
    (total, group) => total + group.modules.length,
    0,
  );
  const selectedTargets = useMemo(
    () =>
      selectedTargetKeys
        .map(parseTargetKey)
        .filter(Boolean)
        .filter((target) => {
          if (!selectedEnvironmentCodeSet.has(target.environmentCode)) {
            return false;
          }

          const moduleItem = activeProjectModules.find((item) => item.id === target.moduleId);
          return Boolean(moduleItem && getModulePortForEnvironment(moduleItem, target.environmentCode));
        }),
    [activeProjectModules, runtimeModuleById, selectedEnvironmentCodeSet, selectedTargetKeys],
  );
  const currentEnvironmentRunRecords = useMemo(
    () =>
      sortRunRecords(
        activeProjectRunRecords.filter(
          (record) => selectedEnvironmentCodeSet.size === 0 || selectedEnvironmentCodeSet.has(record.environmentCode),
        ),
      ),
    [activeProjectRunRecords, selectedEnvironmentCodeSet],
  );
  const activeRunRecordsByModuleId = useMemo(
    () =>
      currentEnvironmentRunRecords.filter(isActiveRunRecord).reduce((moduleRecordMap, record) => {
        const key = buildTargetKey(record.environmentCode, record.moduleId);
        const moduleRecords = moduleRecordMap.get(key) ?? [];
        moduleRecords.push(record);
        moduleRecordMap.set(key, moduleRecords);
        return moduleRecordMap;
      }, new Map()),
    [currentEnvironmentRunRecords],
  );

  useEffect(() => {
    setHasManualEnvironmentSelection(false);
    setSelectedEnvironmentCodes(defaultEnvironmentCode ? [defaultEnvironmentCode] : []);
    setSelectedTargetKeys([]);
    setActiveProcessId('');
    setStartupRecordIds([]);
    setStartResult(null);
    setStopResult(null);
  }, [activeProject?.id, defaultEnvironmentCode]);

  useEffect(() => {
    if (hasManualEnvironmentSelection) {
      return;
    }

    setSelectedEnvironmentCodes(defaultEnvironmentCode ? [defaultEnvironmentCode] : []);
  }, [defaultEnvironmentCode, hasManualEnvironmentSelection]);

  if (!selectedProject) {
    return null;
  }

  function handleToggleModule(environmentCode, moduleId) {
    const moduleItem = activeProjectModules.find((item) => item.id === moduleId);
    if (!moduleItem || !getModulePortForEnvironment(moduleItem, environmentCode)) {
      return;
    }

    const targetKey = buildTargetKey(environmentCode, moduleId);
    setSelectedTargetKeys((currentTargetKeys) =>
      currentTargetKeys.includes(targetKey)
        ? currentTargetKeys.filter((currentTargetKey) => currentTargetKey !== targetKey)
        : [...currentTargetKeys, targetKey],
    );
  }

  function handleToggleEnvironment(environmentCode) {
    setHasManualEnvironmentSelection(true);
    setActiveProcessId('');
    if (selectedEnvironmentCodeSet.has(environmentCode)) {
      return;
    }
    setSelectedEnvironmentCodes([environmentCode]);
    setSelectedTargetKeys((currentTargetKeys) =>
      currentTargetKeys.filter((targetKey) => parseTargetKey(targetKey)?.environmentCode === environmentCode),
    );
  }

  async function handleStartModules() {
    if (selectedTargets.length === 0 || !activeProject || !onStartModules) {
      return;
    }

    let result;
    try {
      result = await onStartModules(activeProject.id, selectedTargets);
    } catch {
      return;
    }
    const failedResults = (result.results ?? []).filter((item) => !item.ok);
    const startedRecordIds = (result.results ?? [])
      .map((item) => item.record?.id)
      .filter(Boolean);
    setStartupRecordIds(startedRecordIds);
    setActiveProcessId(startedRecordIds[0] ?? '');
    setStartResult(failedResults.length > 0 ? { ...result, results: failedResults } : null);
    setStopResult(null);
  }

  async function handleStopModules() {
    if (selectedTargets.length === 0 || !activeProject || !onStopModules) {
      return;
    }

    let result;
    try {
      result = await onStopModules(activeProject.id, selectedTargets);
    } catch {
      return;
    }
    setStopResult(result);
    setStartResult(null);
    setStartupRecordIds([]);
    setActiveProcessId('');
  }

  async function handleStopActiveRecord(record) {
    if (!record?.moduleId || !record.environmentCode || !activeProject || !onStopModules) {
      return;
    }

    setStoppingRecordId(record.id);
    let result;
    try {
      result = await onStopModules(activeProject.id, [
        {
          moduleId: record.moduleId,
          environmentCode: record.environmentCode,
        },
      ]);
    } catch {
      return;
    } finally {
      setStoppingRecordId('');
    }

    const stoppedRecord = (result.stoppedRecords ?? []).find((item) => item.id === record.id);
    if (stoppedRecord) {
      setLiveRecords((currentRecords) => ({
        ...currentRecords,
        [stoppedRecord.id]: stoppedRecord,
      }));

      if (!isActiveRunRecord(stoppedRecord)) {
        setStartupRecordIds((currentRecordIds) =>
          currentRecordIds.filter((recordId) => recordId !== stoppedRecord.id),
        );
        setActiveProcessId((currentRecordId) => (currentRecordId === stoppedRecord.id ? '' : currentRecordId));
      }
    }

    setStopResult(result);
    setStartResult(null);
  }

  async function handleCopyActiveLog() {
    if (!activeLogText) {
      setCopyLogStatus('empty');
      return;
    }

    setCopyLogStatus('copying');
    try {
      await copyTextToClipboard(activeLogText);
      setCopyLogStatus('copied');
    } catch {
      setCopyLogStatus('failed');
    }
  }

  function formatModuleRuntimeState(records) {
    if (!records.length) {
      return '';
    }

    const runningCount = records.filter((record) => record.status === 'running').length;
    const startingCount = records.filter((record) => record.status === 'starting').length;
    if (runningCount > 0) {
      return records.length > 1 ? `运行中 ${records.length}` : '运行中';
    }
    if (startingCount > 0) {
      return records.length > 1 ? `启动中 ${records.length}` : '启动中';
    }
    return records[0]?.statusText ?? '运行中';
  }

  const activeRuntime = activeProject?.runtime;
  const startupRecordIdSet = useMemo(() => new Set(startupRecordIds), [startupRecordIds]);
  const startupRunRecords = useMemo(
    () => currentEnvironmentRunRecords.filter((record) => startupRecordIdSet.has(record.id)),
    [currentEnvironmentRunRecords, startupRecordIdSet],
  );
  const mergedRunRecords = useMemo(
    () =>
      startupRunRecords.map((record) => ({
        ...record,
        ...(liveRecords[record.id] ?? {}),
      })),
    [liveRecords, startupRunRecords],
  );
  const visibleRunRecords = useMemo(() => sortRunRecords(mergedRunRecords), [mergedRunRecords]);
  const visibleRunRecordIds = useMemo(
    () => visibleRunRecords.map((record) => record.id).filter(Boolean),
    [visibleRunRecords],
  );
  const visibleRunRecordIdKey = visibleRunRecordIds.join('|');
  const activeProcessRecord =
    visibleRunRecords.find((record) => record.id === activeProcessId) ?? visibleRunRecords[0] ?? null;
  const activeLogText =
    activeProcessRecord ? liveLogs[activeProcessRecord.id] ?? activeProcessRecord.lastOutput ?? '' : '';

  useEffect(() => {
    setCopyLogStatus('idle');
  }, [activeProcessRecord?.id]);

  useEffect(() => {
    setActiveProcessId((currentId) =>
      visibleRunRecords.some((record) => record.id === currentId)
        ? currentId
        : visibleRunRecords[0]?.id ?? '',
    );
  }, [visibleRunRecords]);

  useEffect(() => {
    if (logRef.current && isLogPinned) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [activeLogText, activeProcessRecord?.id, isLogPinned]);

  useEffect(() => {
    if (visibleRunRecordIds.length === 0 || !onCreateRunLogEventSource) {
      return undefined;
    }

    setIsLogPinned(true);
    const eventSources = [];
    const mergeRecord = (record) => {
      if (!record?.id) {
        return;
      }
      setLiveRecords((currentRecords) => ({
        ...currentRecords,
        [record.id]: {
          ...(currentRecords[record.id] ?? {}),
          ...record,
        },
      }));
    };

    const parseEventPayload = (event) => {
      try {
        return JSON.parse(event.data);
      } catch {
        return null;
      }
    };

    for (const recordId of visibleRunRecordIds) {
      const eventSource = onCreateRunLogEventSource(recordId);
      eventSources.push(eventSource);

      eventSource.addEventListener('snapshot', (event) => {
        const payload = parseEventPayload(event);
        if (!payload?.record?.id) {
          return;
        }
        mergeRecord(payload.record);
        setLiveLogs((currentLogs) => ({
          ...currentLogs,
          [payload.record.id]: payload.text ?? '',
        }));
      });

      eventSource.addEventListener('log', (event) => {
        const payload = parseEventPayload(event);
        if (!payload?.record?.id) {
          return;
        }
        mergeRecord(payload.record);
        setLiveLogs((currentLogs) => ({
          ...currentLogs,
          [payload.record.id]: `${currentLogs[payload.record.id] ?? ''}${payload.text ?? ''}`.slice(-60000),
        }));
      });

      eventSource.addEventListener('record', (event) => {
        const payload = parseEventPayload(event);
        if (payload?.record) {
          mergeRecord(payload.record);
        }
      });

      eventSource.onerror = () => {
        eventSource.close();
      };
    }

    return () => eventSources.forEach((eventSource) => eventSource.close());
  }, [onCreateRunLogEventSource, visibleRunRecordIdKey]);

  function handleLogScroll() {
    const element = logRef.current;
    if (!element) {
      return;
    }
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    setIsLogPinned(distanceToBottom < 24);
  }

  return (
    <section className="control-modal project-detail-modal" aria-label="项目详情">
      <div className="modal-header">
        <h2>项目详情 · {selectedProject.name}</h2>
        <button type="button" aria-label="关闭项目详情" onClick={onClose}>
          <X size={25} />
        </button>
      </div>

      <div className="modal-body project-detail-body">
        {activeRuntime?.blockedReasons?.length ? (
          <div className="runtime-warning">
            {activeRuntime.blockedReasons.join('，')}
          </div>
        ) : null}

        <section className="module-start-panel" aria-label="模块启动">
          <div className="module-start-controls">
            <div className="environment-check-list" aria-label="选择启动环境">
              <span>环境</span>
              <div>
                {orderedEnvironments.map((environment) => (
                  <label
                    className={selectedEnvironmentCodeSet.has(environment.code) ? 'selected' : ''}
                    htmlFor={`environment-radio-${activeProject?.id}-${environment.code}`}
                    key={environment.id}
                  >
                    <input
                      checked={selectedEnvironmentCodeSet.has(environment.code)}
                      id={`environment-radio-${activeProject?.id}-${environment.code}`}
                      name={`environment-radio-${activeProject?.id}`}
                      onChange={() => handleToggleEnvironment(environment.code)}
                      type="radio"
                    />
                    {environment.name}
                  </label>
                ))}
              </div>
            </div>
            <button
              className="primary-action"
              type="button"
              onClick={handleStartModules}
              disabled={isStarting || selectedTargets.length === 0 || !activeRuntime?.canStart}
            >
              <ClipboardList size={18} />
              {isStarting ? '启动中' : '批量启动'}
            </button>
            <button
              className="danger-action"
              type="button"
              onClick={handleStopModules}
              disabled={isStarting || selectedTargets.length === 0}
            >
              <Square size={17} />
              {isStarting ? '处理中' : '批量关停'}
            </button>
            <button className="refresh-list" type="button" onClick={onRefresh} disabled={isRefreshing}>
              <RefreshCw size={18} />
              {isRefreshing ? '刷新中' : '刷新详情'}
            </button>
          </div>

          {selectedEnvironments.length === 0 ? (
            <div className="module-select-list" aria-label="选择启动模块">
              {activeProjectModules.map((moduleItem) => (
                <label
                  className="module-select-item not-configured"
                  htmlFor={`module-check-${activeProject?.id}-none-${moduleItem.id}`}
                  key={moduleItem.id}
                >
                  <input
                    checked={false}
                    disabled
                    id={`module-check-${activeProject?.id}-none-${moduleItem.id}`}
                    type="checkbox"
                  />
                  <span className="module-select-main">
                    <span className="module-select-name">{moduleItem.name}</span>
                  </span>
                  <code>未选择环境</code>
                </label>
              ))}
            </div>
          ) : (
            <div className="environment-module-stack" aria-label="按环境选择启动模块">
              {environmentModuleGroups.map(({ environment, modules: environmentModules }) => (
                <section className="environment-module-panel" key={environment.code}>
                  <div className="environment-module-header">
                    <strong>{environment.name}</strong>
                    <span>{environmentModules.length} 个可启动模块</span>
                  </div>
                  <div className="module-select-list" aria-label={`${environment.name} 模块`}>
                    {environmentModules.map((moduleItem) => {
                      const targetKey = buildTargetKey(environment.code, moduleItem.id);
                      const activeModuleRecords = activeRunRecordsByModuleId.get(targetKey) ?? [];
                      const moduleRuntimeState = formatModuleRuntimeState(activeModuleRecords);
                      return (
                        <label
                          className="module-select-item"
                          htmlFor={`module-check-${activeProject?.id}-${environment.code}-${moduleItem.id}`}
                          key={targetKey}
                        >
                          <input
                            checked={selectedTargetKeys.includes(targetKey)}
                            id={`module-check-${activeProject?.id}-${environment.code}-${moduleItem.id}`}
                            onChange={() => handleToggleModule(environment.code, moduleItem.id)}
                            type="checkbox"
                          />
                          <span className="module-select-main">
                            <span className="module-select-name">{moduleItem.name}</span>
                            {moduleRuntimeState ? (
                              <em className="module-runtime-state">
                                <i aria-hidden="true" />
                                {moduleRuntimeState}
                              </em>
                            ) : null}
                          </span>
                          <code>{getModulePortForEnvironment(moduleItem, environment.code)}</code>
                        </label>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}

          {selectedEnvironments.length > 0 && configuredProjectModuleCount === 0 ? (
            <div className="module-start-result">
              <strong>当前环境没有可启动模块</strong>
              <span>请先到配置管理中保存当前环境和模块的启动端口。</span>
            </div>
          ) : null}

          {startResult?.results?.length ? (
            <div className="module-start-result">
              <strong>{startResult.results.length} 个模块未启动</strong>
              {startResult.results.map((result) => (
                <div className="module-start-command" key={result.module?.id ?? result.moduleId}>
                  <span>
                    {result.module?.name ?? result.moduleId}：
                    {result.message}
                  </span>
                  {result.record?.lastOutput ? <small>日志：{result.record.lastOutput}</small> : null}
                </div>
              ))}
            </div>
          ) : null}

          {stopResult ? (
            <div className="module-start-result stop-result">
              <strong>已关停 {stopResult.stoppedRecords?.length ?? 0} 个模块进程</strong>
              <span>只处理当前项目、当前环境和已选择模块的进程。</span>
            </div>
          ) : null}

          {startupRecordIds.length > 0 && visibleRunRecords.length > 0 ? (
            <section className="startup-process-panel" aria-label="启动过程">
              <div className="startup-process-header">
                <strong>启动过程</strong>
                <span>{visibleRunRecords.length} 条记录</span>
              </div>

              <div className="startup-process-layout">
                <div className="startup-record-list" aria-label="模块启动进程">
                  {visibleRunRecords.map((record) => (
                    <button
                      className={`startup-record-button status-${record.status ?? 'starting'}${record.id === activeProcessRecord?.id ? ' active' : ''}`}
                      key={record.id}
                      type="button"
                      onClick={() => setActiveProcessId(record.id)}
                    >
                      <strong>{record.moduleName}</strong>
                      <span>{record.environmentName ?? record.branchName}</span>
                      <em>{record.statusText ?? '启动中'}</em>
                    </button>
                  ))}
                </div>

                {activeProcessRecord ? (
                  <article className={`startup-process-card status-${activeProcessRecord.status ?? 'starting'}`}>
                    <div className="startup-process-title">
                      <strong>{activeProcessRecord.moduleName}</strong>
                      <div className="startup-process-status-actions">
                        <button
                          className="startup-kill-port-button"
                          type="button"
                          onClick={() => handleStopActiveRecord(activeProcessRecord)}
                          disabled={
                            isStarting ||
                            stoppingRecordId === activeProcessRecord.id ||
                            !isActiveRunRecord(activeProcessRecord) ||
                            !activeProcessRecord.ports?.server
                          }
                          title={`杀掉当前记录端口 ${activeProcessRecord.ports?.server ?? '-'} 对应的进程`}
                        >
                          <Square size={13} />
                          {stoppingRecordId === activeProcessRecord.id ? '处理中' : '杀端口进程'}
                        </button>
                        <span>{activeProcessRecord.statusText ?? '启动中'}</span>
                      </div>
                    </div>
                    <div className="startup-process-meta">
                      <span>环境：{activeProcessRecord.environmentName ?? activeProcessRecord.branchName}</span>
                      <span>端口：{activeProcessRecord.ports?.server ?? '-'}</span>
                      <span>PID：{activeProcessRecord.processId ?? '-'}</span>
                    </div>
                    <small>目录：{activeProcessRecord.cwd}</small>
                    <code>{activeProcessRecord.command}</code>
                    <div className="startup-log-toolbar">
                      <span>实时日志</span>
                      <div className="startup-log-actions">
                        <button
                          className={copyLogStatus === 'copied' ? 'copied' : ''}
                          type="button"
                          onClick={handleCopyActiveLog}
                          disabled={copyLogStatus === 'copying'}
                        >
                          <Copy size={14} />
                          {copyLogStatus === 'copying'
                            ? '复制中'
                            : copyLogStatus === 'copied'
                              ? '已复制'
                              : copyLogStatus === 'empty'
                                ? '无日志'
                                : copyLogStatus === 'failed'
                                  ? '复制失败'
                                  : '复制实时日志'}
                        </button>
                        <button type="button" onClick={() => setIsLogPinned(true)}>
                          滚动到底部
                        </button>
                      </div>
                    </div>
                    <pre ref={logRef} onScroll={handleLogScroll}>
                      {activeLogText || '等待启动日志...'}
                    </pre>
                  </article>
                ) : null}
              </div>
            </section>
          ) : null}
        </section>

      </div>
    </section>
  );
}

export default ProjectDetailModal;
