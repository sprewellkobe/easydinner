#!/bin/bash
# 修复 Taro CoverView 缺少 marker-id 和 slot 属性的问题
# 参考: https://github.com/NervJS/taro/issues/8037

SHARED_FILE="node_modules/@tarojs/shared/dist/components.js"

if [ -f "$SHARED_FILE" ]; then
  # 检查是否已经修复
  if grep -q "'marker-id'" "$SHARED_FILE"; then
    echo "[postinstall] CoverView marker-id 属性已存在，跳过"
  else
    sed -i.bak "s/const CoverView = Object.assign({ 'scroll-top': DEFAULT_FALSE }/const CoverView = Object.assign({ 'scroll-top': DEFAULT_FALSE, 'marker-id': '', 'slot': '' }/" "$SHARED_FILE"
    rm -f "${SHARED_FILE}.bak"
    echo "[postinstall] ✅ 已修复 CoverView marker-id 和 slot 属性"
  fi
fi
