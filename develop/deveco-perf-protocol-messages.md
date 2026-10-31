# DevEco Profiler 协议消息全表（自动提取）

> 来源：`ohos-profiler-26.0.0.865.jar` 的 `com.huawei.deveco.insight.ohos.ability.grpc.protocol` 包。
> 方法：`javap -p` 读生成类的字段（`private <type> <name>_;`），类型按 protobuf-java 命名映射。
> 字段编号未提取（需要时用 `javap -c` 看 `writeUInt32(N, ...)` 的 N）。

共 155 个消息。

## BytracePluginConfigOuterClass

### BytracePluginConfigOuterClass.BytracePluginConfig

| 字段 | 类型 |
| --- | --- |
| buffeSize | int32 |
| categories | com.google.protobuf.LazyStringArrayList |
| time | int32 |
| isRoot | bool |

## CommonTypes

### CommonTypes.ProfilerPluginConfig

| 字段 | 类型 |
| --- | --- |
| sampleInterval | int32 |
| configData | com.google.protobuf.ByteString |
| isProtobufSerialize | bool |

### CommonTypes.ProfilerPluginData

| 字段 | 类型 |
| --- | --- |
| status | int32 |
| data | com.google.protobuf.ByteString |
| clockId | int32 |
| tvSec | int64 |
| tvNsec | int64 |
| sampleInterval | int32 |

### CommonTypes.ProfilerPluginState

| 字段 | 类型 |
| --- | --- |
| state | int32 |
| event | int32 |

## Compaction

### Compaction.MmCompactionBeginFormat

| 字段 | 类型 |
| --- | --- |
| zoneStart | int64 |
| migratePfn | int64 |
| freePfn | int64 |
| zoneEnd | int64 |
| sync | int32 |

### Compaction.MmCompactionDeferCompactionFormat

| 字段 | 类型 |
| --- | --- |
| nid | int32 |
| idx | int32 |
| order | int32 |
| considered | int32 |
| deferShift | int32 |
| orderFailed | int32 |

### Compaction.MmCompactionDeferResetFormat

| 字段 | 类型 |
| --- | --- |
| nid | int32 |
| idx | int32 |
| order | int32 |
| considered | int32 |
| deferShift | int32 |
| orderFailed | int32 |

### Compaction.MmCompactionDeferredFormat

| 字段 | 类型 |
| --- | --- |
| nid | int32 |
| idx | int32 |
| order | int32 |
| considered | int32 |
| deferShift | int32 |
| orderFailed | int32 |

### Compaction.MmCompactionEndFormat

| 字段 | 类型 |
| --- | --- |
| zoneStart | int64 |
| migratePfn | int64 |
| freePfn | int64 |
| zoneEnd | int64 |
| sync | int32 |
| status | int32 |

### Compaction.MmCompactionFinishedFormat

| 字段 | 类型 |
| --- | --- |
| nid | int32 |
| idx | int32 |
| order | int32 |
| ret | int32 |

### Compaction.MmCompactionIsolateFreepagesFormat

| 字段 | 类型 |
| --- | --- |
| startPfn | int64 |
| endPfn | int64 |
| nrScanned | int64 |
| nrTaken | int64 |

### Compaction.MmCompactionIsolateMigratepagesFormat

| 字段 | 类型 |
| --- | --- |
| startPfn | int64 |
| endPfn | int64 |
| nrScanned | int64 |
| nrTaken | int64 |

### Compaction.MmCompactionMigratepagesFormat

| 字段 | 类型 |
| --- | --- |
| nrMigrated | int64 |
| nrFailed | int64 |

### Compaction.MmCompactionSuitableFormat

| 字段 | 类型 |
| --- | --- |
| nid | int32 |
| idx | int32 |
| order | int32 |
| ret | int32 |

### Compaction.MmCompactionTryToCompactPagesFormat

| 字段 | 类型 |
| --- | --- |
| order | int32 |
| gfpMask | int32 |
| prio | int32 |

## CpuPluginConfig

### CpuPluginConfig.CpuConfig

| 字段 | 类型 |
| --- | --- |
| pid | int32 |
| reportProcessInfo | bool |

## CpuPluginResult

### CpuPluginResult.CpuCoreFrequency

| 字段 | 类型 |
| --- | --- |
| minFrequencyKhz | int32 |
| maxFrequencyKhz | int32 |
| curFrequencyKhz | int32 |

### CpuPluginResult.CpuCoreUsageInfo

| 字段 | 类型 |
| --- | --- |
| cpuCore | int32 |
| prevSystemCpuTimeMs | int64 |
| prevSystemBootTimeMs | int64 |
| systemCpuTimeMs | int64 |
| systemBootTimeMs | int64 |
| frequency | CpuPluginResult.CpuCoreFrequency |
| isLittleCore | bool |

### CpuPluginResult.CpuData

| 字段 | 类型 |
| --- | --- |
| cpuUsageInfo | CpuPluginResult.CpuUsageInfo |
| threadInfo | repeated CpuPluginResult.ThreadInfo |
| processNum | int64 |
| userLoad | double |
| sysLoad | double |
| totalLoad | double |

### CpuPluginResult.CpuUsageInfo

| 字段 | 类型 |
| --- | --- |
| prevProcessCpuTimeMs | int64 |
| prevSystemCpuTimeMs | int64 |
| prevSystemBootTimeMs | int64 |
| processCpuTimeMs | int64 |
| systemCpuTimeMs | int64 |
| systemBootTimeMs | int64 |
| cores | repeated CpuPluginResult.CpuCoreUsageInfo |
| timestamp | CpuPluginResult.SampleTimeStamp |

### CpuPluginResult.SampleTimeStamp

| 字段 | 类型 |
| --- | --- |
| tvSec | int64 |
| tvNsec | int64 |

### CpuPluginResult.ThreadInfo

| 字段 | 类型 |
| --- | --- |
| tid | int32 |
| threadState | int32 |
| prevThreadCpuTimeMs | int64 |
| threadCpuTimeMs | int64 |
| timestamp | CpuPluginResult.SampleTimeStamp |

## Cpuhp

### Cpuhp.CpuhpEnterFormat

| 字段 | 类型 |
| --- | --- |
| cpu | int32 |
| target | int32 |
| idx | int32 |
| fun | int64 |

### Cpuhp.CpuhpExitFormat

| 字段 | 类型 |
| --- | --- |
| cpu | int32 |
| state | int32 |
| idx | int32 |
| ret | int32 |

### Cpuhp.CpuhpMultiEnterFormat

| 字段 | 类型 |
| --- | --- |
| cpu | int32 |
| target | int32 |
| idx | int32 |
| fun | int64 |

## DiskioPluginConfig

### DiskioPluginConfig.DiskioConfig

| 字段 | 类型 |
| --- | --- |
| unspeciFied | int32 |
| reportIoStats | int32 |

## DiskioPluginResult

### DiskioPluginResult.CollectTimeStamp

| 字段 | 类型 |
| --- | --- |
| tvSec | int64 |
| tvNsec | int64 |

### DiskioPluginResult.CpuStats

| 字段 | 类型 |
| --- | --- |
| cpuUser | double |
| cpuNice | double |
| cpuSys | double |
| cpuIdle | double |
| cpuIowait | double |
| cpuSteal | double |

### DiskioPluginResult.DiskioData

| 字段 | 类型 |
| --- | --- |
| prevRdSectorsKb | int64 |
| prevWrSectorsKb | int64 |
| prevTimestamp | DiskioPluginResult.CollectTimeStamp |
| rdSectorsKb | int64 |
| wrSectorsKb | int64 |
| timestamp | DiskioPluginResult.CollectTimeStamp |
| statsData | DiskioPluginResult.StatsData |

### DiskioPluginResult.IoStatData

| 字段 | 类型 |
| --- | --- |
| iosPerSec | double |
| rdPerSec | double |
| wrPerSec | double |
| dcPerSec | double |
| rdKb | int64 |
| wrKb | int64 |
| dcKb | int64 |

### DiskioPluginResult.IoStatExData

| 字段 | 类型 |
| --- | --- |
| ioRd | int64 |
| ioRsectors | int64 |
| ioRrqm | int64 |
| ioRrqmPc | int64 |
| ioRAwait | int64 |
| ioRarqsz | int64 |
| ioWr | int64 |
| ioWsectors | int64 |
| ioWrqm | int64 |
| ioWrqmPc | int64 |
| ioWAwait | int64 |
| ioWarqsz | int64 |
| ioDc | int64 |
| ioDsectors | int64 |
| ioDrqm | int64 |
| ioDrqmPc | int64 |
| ioDAwait | int64 |
| ioDarqsz | int64 |
| ioFd | int64 |
| ioFAwait | int64 |
| ioFarqsz | int64 |
| diskUtil | int64 |

### DiskioPluginResult.StatsData

| 字段 | 类型 |
| --- | --- |
| cpuinfo | repeated DiskioPluginResult.CpuStats |
| statsinfo | repeated DiskioPluginResult.IoStatData |
| estatsinfo | repeated DiskioPluginResult.IoStatExData |

## GpuPluginConfig

### GpuPluginConfig.GpuConfig

| 字段 | 类型 |
| --- | --- |
| pid | int32 |
| reportGpuInfo | bool |
| reportGpuDataArray | bool |

## GpuPluginResult

### GpuPluginResult.GpuData

| 字段 | 类型 |
| --- | --- |
| boottime | int64 |
| gpuUtilisation | int64 |
| gpuDataArray | repeated GpuPluginResult.GpuDataExt |

### GpuPluginResult.GpuDataExt

| 字段 | 类型 |
| --- | --- |
| boottime | int64 |
| gpuUtilisation | int64 |

## HidumpPluginConfig

### HidumpPluginConfig.HidumpConfig

| 字段 | 类型 |
| --- | --- |
| reportFps | bool |
| sections | int32 |

## HidumpPluginResult

### HidumpPluginResult.FpsData$TimeSpec

| 字段 | 类型 |
| --- | --- |
| tvSec | int32 |
| tvNsec | int32 |

### HidumpPluginResult.FpsData

| 字段 | 类型 |
| --- | --- |
| id | int32 |
| time | HidumpPluginResult.FpsData.TimeSpec |
| fps | int32 |

### HidumpPluginResult.HidumpInfo

| 字段 | 类型 |
| --- | --- |
| fpsEvent | repeated HidumpPluginResult.FpsData |

## HiperfReport

### HiperfReport.CallStackSample$CallStackFrame

| 字段 | 类型 |
| --- | --- |
| symbolsVaddr | int64 |
| symbolsFileId | int32 |
| functionNameId | int32 |
| loadedVaddr | int64 |

### HiperfReport.CallStackSample

| 字段 | 类型 |
| --- | --- |
| time | int64 |
| tid | int32 |
| callStackFrame | repeated HiperfReport.CallStackSample.CallStackFrame |
| eventCount | int64 |
| configNameId | int32 |

### HiperfReport.HiperfRecord

| 字段 | 类型 |
| --- | --- |
| recordTypeCase | int32 |
| recordType | java.lang.Object |

### HiperfReport.ReportInfo

| 字段 | 类型 |
| --- | --- |
| configName | com.google.protobuf.LazyStringArrayList |

### HiperfReport.SampleStatistic

| 字段 | 类型 |
| --- | --- |
| count | int64 |
| lost | int64 |

### HiperfReport.SymbolTableFile

| 字段 | 类型 |
| --- | --- |
| id | int32 |
| functionName | com.google.protobuf.LazyStringArrayList |

### HiperfReport.VirtualThreadInfo

| 字段 | 类型 |
| --- | --- |
| tid | int32 |
| pid | int32 |

## HisyseventPluginResult

### HisyseventPluginResult.HisyseventInfo

| 字段 | 类型 |
| --- | --- |
| info | repeated HisyseventPluginResult.HisyseventLine |

### HisyseventPluginResult.HisyseventLine

| 字段 | 类型 |
| --- | --- |
| id | int64 |

## MemoryPluginConfig

### MemoryPluginConfig.MemoryConfig

| 字段 | 类型 |
| --- | --- |
| reportProcessTree | bool |
| reportSysmemMemInfo | bool |
| sysMeminfoCounters | repeated Integer |
| reportSysmemVmemInfo | bool |
| sysVmeminfoCounters | repeated Integer |
| reportProcessMemInfo | bool |
| reportAppMemInfo | bool |
| reportAppMemByMemoryService | bool |
| pid | Internal.IntList |
| reportSmapsMemInfo | bool |
| reportPurgeableAshmemInfo | bool |
| reportDmaMemInfo | bool |
| reportGpuMemInfo | bool |
| reportGpuDumpInfo | bool |
| reportFakeData | bool |
| parseSmapsRollup | bool |

## MemoryPluginResult

### MemoryPluginResult.AppSummary

| 字段 | 类型 |
| --- | --- |
| javaHeap | int64 |
| nativeHeap | int64 |
| code | int64 |
| stack | int64 |
| graphics | int64 |
| privateOther | int64 |
| system | int64 |

### MemoryPluginResult.AshmemInfo

| 字段 | 类型 |
| --- | --- |
| pid | int32 |
| adj | int32 |
| fd | int32 |
| size | int64 |
| id | int32 |
| time | int64 |
| refCount | int64 |
| purged | int64 |

### MemoryPluginResult.CpuDumpInfo

| 字段 | 类型 |
| --- | --- |
| totalCpuMemorySize | int64 |

### MemoryPluginResult.DmaInfo

| 字段 | 类型 |
| --- | --- |
| pid | int32 |
| fd | int32 |
| size | int64 |
| ino | int32 |
| expPid | int32 |

### MemoryPluginResult.GpuDumpInfo$GpuDetailInfo$GpuSubInfo

| 字段 | 类型 |
| --- | --- |
| size | int64 |
| entryNum | int32 |

### MemoryPluginResult.GpuDumpInfo$GpuDetailInfo

| 字段 | 类型 |
| --- | --- |
| gpuSubInfo | repeated MemoryPluginResult.GpuDumpInfo.GpuDetailInfo.GpuSubInfo |

### MemoryPluginResult.GpuDumpInfo

| 字段 | 类型 |
| --- | --- |
| id | int64 |
| gpuDetailInfo | repeated MemoryPluginResult.GpuDumpInfo.GpuDetailInfo |
| gpuPurgeableSize | int64 |

### MemoryPluginResult.GpuMemoryInfo$GpuProcessInfo

| 字段 | 类型 |
| --- | --- |
| pid | int32 |
| tid | int32 |
| usedGpuSize | int64 |

### MemoryPluginResult.GpuMemoryInfo

| 字段 | 类型 |
| --- | --- |
| allGpuSize | int64 |
| gpuProcessInfo | repeated MemoryPluginResult.GpuMemoryInfo.GpuProcessInfo |

### MemoryPluginResult.MemoryData

| 字段 | 类型 |
| --- | --- |
| processesinfo | repeated MemoryPluginResult.ProcessMemoryInfo |
| meminfo | repeated MemoryPluginResult.SysMeminfo |
| vmeminfo | repeated MemoryPluginResult.SysVMeminfo |
| zram | int64 |
| ashmeminfo | repeated MemoryPluginResult.AshmemInfo |
| dmainfo | repeated MemoryPluginResult.DmaInfo |
| gpumemoryinfo | repeated MemoryPluginResult.GpuMemoryInfo |
| gpudumpinfo | repeated MemoryPluginResult.GpuDumpInfo |
| gpuLimitSize | int64 |
| gpuUsedSize | int64 |
| rsdumpinfo | repeated MemoryPluginResult.RSImageDumpInfo |
| cpudumpinfo | repeated MemoryPluginResult.CpuDumpInfo |
| windowinfo | repeated MemoryPluginResult.WindowManagerServiceInfo |
| profilememinfo | repeated MemoryPluginResult.ProfileMemInfo |

### MemoryPluginResult.ProcessMemoryInfo

| 字段 | 类型 |
| --- | --- |
| pid | int32 |
| vmSizeKb | int64 |
| vmRssKb | int64 |
| rssAnonKb | int64 |
| rssFileKb | int64 |
| rssShmemKb | int64 |
| vmSwapKb | int64 |
| vmLockedKb | int64 |
| vmHwmKb | int64 |
| oomScoreAdj | int64 |
| smapinfo | repeated MemoryPluginResult.SmapsInfo |
| memsummary | MemoryPluginResult.AppSummary |
| purgSumKb | int64 |
| purgPinKb | int64 |
| glPssKb | int64 |
| graphPssKb | int64 |

### MemoryPluginResult.ProfileMemInfo

| 字段 | 类型 |
| --- | --- |
| totalMemorySize | int64 |

### MemoryPluginResult.RSImageDumpInfo

| 字段 | 类型 |
| --- | --- |
| size | int64 |
| pid | int32 |

### MemoryPluginResult.SmapsInfo

| 字段 | 类型 |
| --- | --- |
| size | int64 |
| rss | int64 |
| pss | int64 |
| reside | double |
| dirty | int64 |
| swapper | int64 |
| privateClean | int64 |
| privateDirty | int64 |
| sharedClean | int64 |
| sharedDirty | int64 |
| swap | int64 |
| swapPss | int64 |

### MemoryPluginResult.SysMeminfo

| 字段 | 类型 |
| --- | --- |
| key | int32 |
| value | int64 |

### MemoryPluginResult.SysVMeminfo

| 字段 | 类型 |
| --- | --- |
| key | int32 |
| value | int64 |

### MemoryPluginResult.WindowManagerServiceInfo

| 字段 | 类型 |
| --- | --- |
| pid | int32 |

## NativeHookConfigOuterClass

### NativeHookConfigOuterClass.NativeHookConfig

| 字段 | 类型 |
| --- | --- |
| pid | int32 |
| saveFile | bool |
| filterSize | int32 |
| smbPages | int32 |
| maxStackDepth | int32 |
| mallocDisable | bool |
| mmapDisable | bool |
| freeStackReport | bool |
| munmapStackReport | bool |
| mallocFreeMatchingInterval | int32 |
| mallocFreeMatchingCnt | int32 |
| stringCompressed | bool |
| fpUnwind | bool |
| blocked | bool |
| recordAccurately | bool |
| startupMode | bool |
| memtraceEnable | bool |
| offlineSymbolization | bool |
| callframeCompress | bool |
| statisticsInterval | int32 |
| sampleInterval | int32 |
| responseLibraryMode | bool |
| expandPids | Internal.IntList |
| jsStackReport | int32 |
| maxJsStackDepth | int32 |
| dumpNmd | bool |
| restraceTag | com.google.protobuf.LazyStringArrayList |
| asyncStackEnable | bool |
| asyncType | repeated Integer |
| uniqueStackTableSize | int32 |
| useFileCacheMode | bool |
| fileCacheBufferSize | int32 |
| allocatorSamplingEnable | bool |
| nativeOrphansnapshotsEnable | bool |
| nestedAsyncStackEnable | bool |
| asyncNestingDepth | int32 |
| asyncTaskStackDepth | int32 |
| arkuiMemTraceEnable | bool |
| discardDestroyedTraces | bool |

## NativeHookResult

### NativeHookResult.AllocEvent

| 字段 | 类型 |
| --- | --- |
| pid | int32 |
| tid | int32 |
| addr | int64 |
| size | int64 |
| frameInfo | repeated NativeHookResult.Frame |
| threadNameId | int32 |
| stackId | int32 |
| nodeType | int32 |
| nodeId | int64 |

### NativeHookResult.BatchNativeHookData

| 字段 | 类型 |
| --- | --- |
| events | repeated NativeHookResult.NativeHookData |

### NativeHookResult.FilePathMap

| 字段 | 类型 |
| --- | --- |
| id | int32 |
| pid | int32 |
| adltBase | int64 |

### NativeHookResult.Frame

| 字段 | 类型 |
| --- | --- |
| ip | int64 |
| sp | int64 |
| offset | int64 |
| symbolOffset | int64 |
| symbolNameId | int32 |
| filePathId | int32 |

### NativeHookResult.FrameMap

| 字段 | 类型 |
| --- | --- |
| id | int32 |
| frame | NativeHookResult.Frame |
| pid | int32 |

### NativeHookResult.FreeEvent

| 字段 | 类型 |
| --- | --- |
| pid | int32 |
| tid | int32 |
| addr | int64 |
| frameInfo | repeated NativeHookResult.Frame |
| threadNameId | int32 |
| stackId | int32 |

### NativeHookResult.MapsInfo

| 字段 | 类型 |
| --- | --- |
| pid | int32 |
| start | int64 |
| end | int64 |
| offset | int64 |
| filePathId | int32 |

### NativeHookResult.MemTagEvent

| 字段 | 类型 |
| --- | --- |
| addr | int64 |
| size | int64 |
| pid | int32 |

### NativeHookResult.MmapEvent

| 字段 | 类型 |
| --- | --- |
| pid | int32 |
| tid | int32 |
| addr | int64 |
| size | int64 |
| frameInfo | repeated NativeHookResult.Frame |
| threadNameId | int32 |
| stackId | int32 |
| nodeType | int32 |
| nodeId | int64 |

### NativeHookResult.MunmapEvent

| 字段 | 类型 |
| --- | --- |
| pid | int32 |
| tid | int32 |
| addr | int64 |
| size | int64 |
| frameInfo | repeated NativeHookResult.Frame |
| threadNameId | int32 |
| stackId | int32 |

### NativeHookResult.NativeHookData

| 字段 | 类型 |
| --- | --- |
| eventCase | int32 |
| event | java.lang.Object |
| tvSec | int64 |
| tvNsec | int64 |

### NativeHookResult.RecordStatisticsEvent

| 字段 | 类型 |
| --- | --- |
| pid | int32 |
| callstackId | int32 |
| type | int32 |
| applyCount | int64 |
| releaseCount | int64 |
| applySize | int64 |
| releaseSize | int64 |
| nodeType | int32 |
| nodeId | int64 |
| addr | Internal.LongList |

### NativeHookResult.StackMap

| 字段 | 类型 |
| --- | --- |
| id | int32 |
| frameMapId | Internal.LongList |
| ip | Internal.LongList |
| pid | int32 |

### NativeHookResult.SymbolMap

| 字段 | 类型 |
| --- | --- |
| id | int32 |
| pid | int32 |

### NativeHookResult.SymbolTable

| 字段 | 类型 |
| --- | --- |
| filePathId | int32 |
| textExecVaddr | int64 |
| textExecVaddrFileOffset | int64 |
| symEntrySize | int64 |
| symTable | com.google.protobuf.ByteString |
| strTable | com.google.protobuf.ByteString |
| pid | int32 |

### NativeHookResult.ThreadNameMap

| 字段 | 类型 |
| --- | --- |
| id | int32 |
| pid | int32 |

### NativeHookResult.TraceAllocEvent

| 字段 | 类型 |
| --- | --- |
| pid | int32 |
| tid | int32 |
| addr | int64 |
| traceType | int32 |
| size | int64 |
| frameInfo | repeated NativeHookResult.Frame |
| threadNameId | int32 |
| stackId | int32 |
| nodeType | int32 |
| nodeId | int32 |

### NativeHookResult.TraceFreeEvent

| 字段 | 类型 |
| --- | --- |
| pid | int32 |
| tid | int32 |
| addr | int64 |
| traceType | int32 |
| frameInfo | repeated NativeHookResult.Frame |
| threadNameId | int32 |
| stackId | int32 |

### NativeHookResult.TraceFreeRegionEvent

| 字段 | 类型 |
| --- | --- |
| pid | int32 |
| tid | int32 |
| addr | int64 |
| traceType | int32 |
| size | int64 |

### NativeHookResult.TraceMoveEvent

| 字段 | 类型 |
| --- | --- |
| pid | int32 |
| tid | int32 |
| addr | int64 |
| newAddr | int64 |
| traceType | int32 |
| size | int64 |

## NetworkPluginConfig

### NetworkPluginConfig.NetworkConfig

| 字段 | 类型 |
| --- | --- |
| pid | Internal.IntList |
| singlePid | int32 |

## NetworkPluginResult

### NetworkPluginResult.NetworkData

| 字段 | 类型 |
| --- | --- |
| pid | int32 |
| tvSec | int64 |
| tvNsec | int64 |
| txBytes | int64 |
| rxBytes | int64 |
| details | repeated NetworkPluginResult.NetworkDetails |

### NetworkPluginResult.NetworkDatas

| 字段 | 类型 |
| --- | --- |
| networkinfo | repeated NetworkPluginResult.NetworkData |
| networkSystemInfo | NetworkPluginResult.NetworkSystemData |

### NetworkPluginResult.NetworkDetails

| 字段 | 类型 |
| --- | --- |
| txBytes | int64 |
| rxBytes | int64 |

### NetworkPluginResult.NetworkFlowData

| 字段 | 类型 |
| --- | --- |
| pid | int32 |
| tvSec | int64 |
| tvNsec | int64 |
| rxBytes | int64 |
| rxPackets | int64 |
| txBytes | int64 |
| txPackets | int64 |
| details | repeated NetworkPluginResult.NetworkFlowDetail |

### NetworkPluginResult.NetworkFlowDetail

| 字段 | 类型 |
| --- | --- |
| rxBytes | int64 |
| rxPackets | int64 |
| txBytes | int64 |
| txPackets | int64 |

### NetworkPluginResult.NetworkSystemData

| 字段 | 类型 |
| --- | --- |
| tvSec | int64 |
| tvNsec | int64 |
| rxBytes | int64 |
| rxPackets | int64 |
| txBytes | int64 |
| txPackets | int64 |
| details | repeated NetworkPluginResult.NetworkSystemDetails |

### NetworkPluginResult.NetworkSystemDetails

| 字段 | 类型 |
| --- | --- |
| rxBytes | int64 |
| rxPackets | int64 |
| txBytes | int64 |
| txPackets | int64 |

## NetworkProfilerConfigOuterClass

### NetworkProfilerConfigOuterClass.NetworkProfilerConfig

| 字段 | 类型 |
| --- | --- |
| pid | Internal.LongList |
| startupProcessName | com.google.protobuf.LazyStringArrayList |
| restartProcessName | com.google.protobuf.LazyStringArrayList |
| clockId | int32 |
| smbPages | int32 |
| flushInterval | int32 |
| block | bool |

## NetworkProfilerEventOuterClass

### NetworkProfilerEventOuterClass.NetworkProfilerEvent

| 字段 | 类型 |
| --- | --- |
| tvSec | int64 |
| tvNsec | int64 |
| uid | int32 |
| type | int32 |
| pid | int32 |
| tid | int32 |
| processName | com.google.protobuf.ByteString |
| threadName | com.google.protobuf.ByteString |
| payload | com.google.protobuf.ByteString |

### NetworkProfilerEventOuterClass.NetworkProfilerResult

| 字段 | 类型 |
| --- | --- |
| networkEvent | repeated NetworkProfilerEventOuterClass.NetworkProfilerEvent |

## PluginServiceTypes

### PluginServiceTypes.BufferDescriptor

| 字段 | 类型 |
| --- | --- |
| bufferId | int32 |
| offset | int32 |
| length | int32 |

### PluginServiceTypes.CreateSessionCmd

| 字段 | 类型 |
| --- | --- |
| bufferSizes | Internal.IntList |
| pluginConfigs | repeated CommonTypes.ProfilerPluginConfig |

### PluginServiceTypes.DestroySessionCmd

| 字段 | 类型 |
| --- | --- |
| pluginIds | Internal.IntList |

### PluginServiceTypes.GetCommandRequest

| 字段 | 类型 |
| --- | --- |
| requestId | int32 |

### PluginServiceTypes.GetCommandResponse

| 字段 | 类型 |
| --- | --- |
| commandCase | int32 |
| command | java.lang.Object |
| status | int32 |
| hasMore | bool |
| commandId | int32 |

### PluginServiceTypes.NotifyResultRequest

| 字段 | 类型 |
| --- | --- |
| requestId | int32 |
| commandId | int32 |
| result | repeated PluginServiceTypes.PluginResult |

### PluginServiceTypes.NotifyResultResponse

| 字段 | 类型 |
| --- | --- |
| status | int32 |

### PluginServiceTypes.PluginResult

| 字段 | 类型 |
| --- | --- |
| descriptorCase | int32 |
| descriptor | java.lang.Object |
| pluginId | int32 |
| status | CommonTypes.ProfilerPluginState |

### PluginServiceTypes.RefreshSessionCmd

| 字段 | 类型 |
| --- | --- |
| pluginIds | Internal.IntList |

### PluginServiceTypes.RegisterPluginRequest

| 字段 | 类型 |
| --- | --- |
| requestId | int32 |
| bufferSizeHint | int32 |
| isStandaloneData | bool |

### PluginServiceTypes.RegisterPluginResponse

| 字段 | 类型 |
| --- | --- |
| status | int32 |
| pluginId | int32 |

### PluginServiceTypes.StartSessionCmd

| 字段 | 类型 |
| --- | --- |
| pluginIds | Internal.IntList |
| pluginConfigs | repeated CommonTypes.ProfilerPluginConfig |

### PluginServiceTypes.StopSessionCmd

| 字段 | 类型 |
| --- | --- |
| pluginIds | Internal.IntList |

### PluginServiceTypes.UnregisterPluginRequest

| 字段 | 类型 |
| --- | --- |
| requestId | int32 |
| pluginId | int32 |

### PluginServiceTypes.UnregisterPluginResponse

| 字段 | 类型 |
| --- | --- |
| status | int32 |

## ProfilerServiceTypes

### ProfilerServiceTypes.CreateSessionRequest

| 字段 | 类型 |
| --- | --- |
| requestId | int32 |
| sessionConfig | ProfilerServiceTypes.ProfilerSessionConfig |
| pluginConfigs | repeated CommonTypes.ProfilerPluginConfig |

### ProfilerServiceTypes.CreateSessionResponse

| 字段 | 类型 |
| --- | --- |
| status | int32 |
| sessionId | int32 |
| pluginStatus | repeated CommonTypes.ProfilerPluginState |

### ProfilerServiceTypes.DestroySessionRequest

| 字段 | 类型 |
| --- | --- |
| requestId | int32 |
| sessionId | int32 |

### ProfilerServiceTypes.DestroySessionResponse

| 字段 | 类型 |
| --- | --- |
| status | int32 |
| pluginStatus | repeated CommonTypes.ProfilerPluginState |

### ProfilerServiceTypes.FetchDataRequest

| 字段 | 类型 |
| --- | --- |
| requestId | int32 |
| sessionId | int32 |
| addtionData | com.google.protobuf.ByteString |

### ProfilerServiceTypes.FetchDataResponse

| 字段 | 类型 |
| --- | --- |
| status | int32 |
| responseId | int32 |
| hasMore | bool |
| pluginData | repeated CommonTypes.ProfilerPluginData |

### ProfilerServiceTypes.GetCapabilitiesRequest

| 字段 | 类型 |
| --- | --- |
| requestId | int32 |

### ProfilerServiceTypes.GetCapabilitiesResponse

| 字段 | 类型 |
| --- | --- |
| status | int32 |
| capabilities | repeated ProfilerServiceTypes.ProfilerPluginCapability |

### ProfilerServiceTypes.KeepSessionRequest

| 字段 | 类型 |
| --- | --- |
| requestId | int32 |
| sessionId | int32 |
| keepAliveTime | int32 |

### ProfilerServiceTypes.KeepSessionResponse

| 字段 | 类型 |
| --- | --- |
| status | int32 |

### ProfilerServiceTypes.ProfilerSessionConfig$BufferConfig

| 字段 | 类型 |
| --- | --- |
| pages | int32 |
| policy | int32 |

### ProfilerServiceTypes.ProfilerSessionConfig

| 字段 | 类型 |
| --- | --- |
| buffers | repeated ProfilerServiceTypes.ProfilerSessionConfig.BufferConfig |
| sessionMode | int32 |
| resultMaxSize | int32 |
| sampleDuration | int32 |
| keepAliveTime | int32 |
| discardCacheData | bool |
| splitFile | bool |
| singleFileMaxSizeMb | int32 |

### ProfilerServiceTypes.StartSessionRequest

| 字段 | 类型 |
| --- | --- |
| requestId | int32 |
| sessionId | int32 |
| updateConfigs | repeated CommonTypes.ProfilerPluginConfig |

### ProfilerServiceTypes.StartSessionResponse

| 字段 | 类型 |
| --- | --- |
| status | int32 |
| pluginStatus | repeated CommonTypes.ProfilerPluginState |

### ProfilerServiceTypes.StopSessionRequest

| 字段 | 类型 |
| --- | --- |
| requestId | int32 |
| sessionId | int32 |

### ProfilerServiceTypes.StopSessionResponse

| 字段 | 类型 |
| --- | --- |
| status | int32 |
| pluginStatus | repeated CommonTypes.ProfilerPluginState |

### ProfilerServiceTypes.SubscribeProfilerEvtRequest

| 字段 | 类型 |
| --- | --- |
| requestId | int32 |
| sessionId | int32 |
| addtionData | com.google.protobuf.ByteString |

### ProfilerServiceTypes.SubscribeProfilerEvtResponse

| 字段 | 类型 |
| --- | --- |
| status | int32 |
| responseId | int32 |
| hasMore | bool |
| pluginState | repeated CommonTypes.ProfilerPluginState |

## TracePluginConfigOuterClass

### TracePluginConfigOuterClass.TracePluginConfig

| 字段 | 类型 |
| --- | --- |
| ftraceEvents | com.google.protobuf.LazyStringArrayList |
| hitraceCategories | com.google.protobuf.LazyStringArrayList |
| hitraceApps | com.google.protobuf.LazyStringArrayList |
| bufferSizeKb | int32 |
| flushIntervalMs | int32 |
| flushThresholdKb | int32 |
| parseKsyms | bool |
| tracePeriodMs | int32 |
| traceDurationMs | int32 |
| debugOn | bool |
| discardCacheData | bool |
| hitraceTime | int32 |

## XpowerPluginConfig

### XpowerPluginConfig.XpowerConfig

| 字段 | 类型 |
| --- | --- |
| messageType | repeated Integer |

## XpowerPluginResult

### XpowerPluginResult.AbnormalEventInfo

| 字段 | 类型 |
| --- | --- |
| abnormalType | int32 |
| usageTime | int64 |
| usageEnergy | int64 |
| usageLoad | int64 |
| usageFreq | int64 |
| usageCount | int32 |

### XpowerPluginResult.AbnormalEvents

| 字段 | 类型 |
| --- | --- |
| anomalyStartTime | int64 |
| anomalyEndTime | int64 |
| count | int32 |
| events | repeated XpowerPluginResult.AbnormalEventInfo |

### XpowerPluginResult.AppDetail

| 字段 | 类型 |
| --- | --- |
| cpu | XpowerPluginResult.AppDetailCPU |
| gpu | XpowerPluginResult.AppDetailGPU |
| wifi | XpowerPluginResult.AppDetailWifi |
| display | XpowerPluginResult.AppDetailDisplay |
| displayExt | XpowerPluginResult.AppDetailDisplayExt |
| highLoad | XpowerPluginResult.AppDetailHighLoad |

### XpowerPluginResult.AppDetailCPU

| 字段 | 类型 |
| --- | --- |
| threadCount | int32 |
| threadLoad | Internal.LongList |
| threadName | com.google.protobuf.LazyStringArrayList |
| threadTime | Internal.LongList |
| threadEnergy | Internal.LongList |

### XpowerPluginResult.AppDetailDisplay

| 字段 | 类型 |
| --- | --- |
| count1Hz | int64 |
| count5Hz | int64 |
| count10Hz | int64 |
| count15Hz | int64 |
| count24Hz | int64 |
| count30Hz | int64 |
| count45Hz | int64 |
| count60Hz | int64 |
| count90Hz | int64 |
| count120Hz | int64 |
| count180Hz | int64 |

### XpowerPluginResult.AppDetailDisplayExt

| 字段 | 类型 |
| --- | --- |
| rsSkip | XpowerPluginResult.RenderServiceSkip |
| gpuRedraw | XpowerPluginResult.GpuRedraw |

### XpowerPluginResult.AppDetailGPU

| 字段 | 类型 |
| --- | --- |
| frequencyCount1 | int64 |
| frequency2 | Internal.LongList |
| idleTime | Internal.LongList |
| runTime | Internal.LongList |

### XpowerPluginResult.AppDetailHighLoad

| 字段 | 类型 |
| --- | --- |
| pid | int32 |
| tid | int32 |
| load | int32 |

### XpowerPluginResult.AppDetailWifi

| 字段 | 类型 |
| --- | --- |
| txPackets | int64 |
| rxPackets | int64 |
| txBytes | int64 |
| rxBytes | int64 |

### XpowerPluginResult.AppStatistic

| 字段 | 类型 |
| --- | --- |
| audio | XpowerPluginResult.AppStatisticCommon |
| bluetooth | XpowerPluginResult.AppStatisticCommon |
| camera | XpowerPluginResult.AppStatisticCommon |
| cpu | XpowerPluginResult.AppStatisticCommon |
| display | XpowerPluginResult.AppStatisticCommon |
| flashlight | XpowerPluginResult.AppStatisticCommon |
| gpu | XpowerPluginResult.AppStatisticCommon |
| location | XpowerPluginResult.AppStatisticCommon |
| wifiscan | XpowerPluginResult.AppStatisticCommon |
| wifi | XpowerPluginResult.AppStatisticCommon |
| modem | XpowerPluginResult.AppStatisticCommon |

### XpowerPluginResult.AppStatisticCommon

| 字段 | 类型 |
| --- | --- |
| energy | int64 |
| time | int64 |

### XpowerPluginResult.ComponentTop

| 字段 | 类型 |
| --- | --- |
| audio | XpowerPluginResult.ComponentTopCommon |
| bluetooth | XpowerPluginResult.ComponentTopCommon |
| camera | XpowerPluginResult.ComponentTopCamera |
| cpu | XpowerPluginResult.ComponentTopCpu |
| display | XpowerPluginResult.ComponentTopDisplay |
| flashlight | XpowerPluginResult.ComponentTopCommon |
| gpu | XpowerPluginResult.ComponentTopDisplay |
| location | XpowerPluginResult.ComponentTopCommon |
| wifiscan | XpowerPluginResult.ComponentTopCommon |

### XpowerPluginResult.ComponentTopCamera

| 字段 | 类型 |
| --- | --- |
| count | int32 |
| appname | com.google.protobuf.LazyStringArrayList |
| cameraId | Internal.LongList |
| backgroundDuration | Internal.LongList |
| backgroundEnergy | Internal.LongList |
| foregroundDuration | Internal.LongList |
| foregroundEnergy | Internal.LongList |
| screenOffDuration | Internal.LongList |
| screenOffEnergy | Internal.LongList |
| screenOnDuration | Internal.LongList |
| screenOnEnergy | Internal.LongList |

### XpowerPluginResult.ComponentTopCommon

| 字段 | 类型 |
| --- | --- |
| count | int32 |
| appname | com.google.protobuf.LazyStringArrayList |
| backgroundDuration | Internal.LongList |
| backgroundEnergy | Internal.LongList |
| foregroundDuration | Internal.LongList |
| foregroundEnergy | Internal.LongList |
| screenOffDuration | Internal.LongList |
| screenOffEnergy | Internal.LongList |
| screenOnDuration | Internal.LongList |
| screenOnEnergy | Internal.LongList |

### XpowerPluginResult.ComponentTopCpu

| 字段 | 类型 |
| --- | --- |
| count | int32 |
| appname | com.google.protobuf.LazyStringArrayList |
| uid | Internal.LongList |
| backgroundDuration | Internal.LongList |
| backgroundEnergy | Internal.LongList |
| foregroundDuration | Internal.LongList |
| foregroundEnergy | Internal.LongList |
| screenOffDuration | Internal.LongList |
| screenOffEnergy | Internal.LongList |
| screenOnDuration | Internal.LongList |
| screenOnEnergy | Internal.LongList |
| load | Internal.LongList |

### XpowerPluginResult.ComponentTopDisplay

| 字段 | 类型 |
| --- | --- |
| count | int32 |
| appname | com.google.protobuf.LazyStringArrayList |
| time | Internal.LongList |
| energy | Internal.LongList |

### XpowerPluginResult.GpuRedraw

| 字段 | 类型 |
| --- | --- |
| backgroundAlpha | XpowerPluginResult.ReasonInfo |
| filterRect | XpowerPluginResult.ReasonInfo |

### XpowerPluginResult.OptimizeReport

| 字段 | 类型 |
| --- | --- |
| startTime | int64 |
| endTime | int64 |
| messageType | int32 |
| realBattery | XpowerPluginResult.RealBattery |
| appStatistic | XpowerPluginResult.AppStatistic |
| appDetail | XpowerPluginResult.AppDetail |
| componentTop | XpowerPluginResult.ComponentTop |
| abnormalEvents | XpowerPluginResult.AbnormalEvents |
| thermalReport | XpowerPluginResult.ThermalReport |
| startTimeB | int64 |
| endTimeB | int64 |

### XpowerPluginResult.RealBattery

| 字段 | 类型 |
| --- | --- |
| capacity | int64 |
| charge | int64 |
| current | int64 |
| gasGauge | int64 |
| level | int64 |
| screen | int64 |
| realCurrent | Internal.IntList |

### XpowerPluginResult.ReasonInfo

| 字段 | 类型 |
| --- | --- |
| frameNum | int32 |

### XpowerPluginResult.RenderServiceSkip

| 字段 | 类型 |
| --- | --- |
| skipNum | int32 |

### XpowerPluginResult.ThermalReport

| 字段 | 类型 |
| --- | --- |
| shellTemp | int64 |
| thermalLevel | int64 |
