#!/usr/bin/env bash
# 等 Agent Helm Core daemon(3457)就绪再启动 dsh,最多 90s,避免插件与 daemon 抢占。
for i in $(seq 1 90); do
  if (exec 3<>/dev/tcp/127.0.0.1/3457) 2>/dev/null; then exec 3>&-; exit 0; fi
  sleep 1
done
exit 0
