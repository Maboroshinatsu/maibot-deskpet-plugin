<template>
  <Transition name="companion-slide">
    <div
      v-if="open"
      ref="companionRootRef"
      class="companion-window settings-companion"
      :class="[`pop-${popDirectionX}`, `align-${alignY}`]"
      @mousedown.stop
      @wheel.stop
    >
      <!-- 顶部有机导航栏：左侧自定义功能圆点 + 居中胶囊导航 + 右侧独立关闭按钮 -->
      <div class="bio-header">
        <button
          ref="orbBtnRef"
          type="button"
          class="bio-orb-btn"
          :class="{ active: quickModelBarOpen && store.orbAction === 'model_picker' }"
          :title="orbTooltip"
          @mousemove="onOrbMouseMove"
          @mouseleave="onOrbMouseLeave"
          @click="onOrbClick"
        >
          <input
            ref="orbColorInputRef"
            type="color"
            class="bio-orb-color-input"
            :value="store.accentColor"
            tabindex="-1"
            @click.stop
            @input="onAccentColorInput"
          />
        </button>

        <div ref="navBarRef" class="bio-nav">
          <span class="bio-nav-slider" aria-hidden="true" />
          <button
            type="button"
            class="bio-tab"
            :class="{ active: activeTab === 'states' }"
            @click="switchTab('states')"
          >
            状态预设
          </button>
          <button
            v-if="displayMode === 'live2d'"
            type="button"
            class="bio-tab"
            :class="{ active: activeTab === 'studio' }"
            @click="switchTab('studio')"
          >
            预设工坊
          </button>
          <button
            type="button"
            class="bio-tab"
            :class="{ active: activeTab === 'settings' }"
            @click="switchTab('settings')"
          >
            面板设置
          </button>
        </div>

        <button
          type="button"
          class="bio-icon-btn"
          title="收起面板"
          @click="$emit('close')"
        >
          <svg viewBox="0 0 24 24">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- 左上角圆点快捷呼出的模型选择栏（0fr <-> 1fr 弹簧抽屉 + 错峰弹入列表） -->
      <div
        class="quick-drawer-collapse"
        :class="{ open: quickModelBarOpen }"
      >
        <div class="quick-drawer-inner">
          <div class="bio-quick-model-drawer">
            <div class="quick-drawer-head">
              <div class="studio-mode-strip quick-mode-strip">
                <button
                  type="button"
                  class="studio-mode-btn pressable"
                  :class="{ active: displayMode === 'live2d' }"
                  :disabled="switching || !models.some((m) => m.kind === 'live2d')"
                  @click="setDisplayMode('live2d')"
                >
                  Live2D 模型
                </button>
                <button
                  type="button"
                  class="studio-mode-btn pressable"
                  :class="{ active: displayMode === 'image-set' }"
                  :disabled="switching || !models.some((m) => m.kind === 'image-set')"
                  @click="setDisplayMode('image-set')"
                >
                  静态立绘
                </button>
              </div>
              <button
                type="button"
                class="bio-btn-pill pressable"
                :disabled="switching"
                title="重新扫描模型目录"
                @click="rescan"
              >
                刷新
              </button>
            </div>

            <div v-if="filteredModels.length === 0" class="bio-model-empty">
              未发现{{ displayMode === 'live2d' ? ' Live2D 模型' : '静态立绘包' }}
            </div>
            <div v-else :key="displayMode" class="bio-model-list">
              <button
                v-for="(m, mIdx) in filteredModels"
                :key="m.url"
                type="button"
                class="bio-model-item pressable"
                :class="{ active: selectedModel === m.url }"
                :style="{ '--model-i': Math.min(mIdx, 8) }"
                :disabled="switching"
                @click="selectModelUrl(m.url)"
              >
                <span class="ctrl-dot" />
                <span class="bio-model-item-name">{{ m.name }}</span>
                <span v-if="selectedModel === m.url" class="bio-model-item-tag">当前</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <Transition name="bio-tab-switch" mode="out-in">
        <!-- ==================== 页签 1：状态预设（日常纯净点选 + 统一等宽胶囊） ==================== -->
        <div
          v-if="activeTab === 'states'"
          key="states"
          class="bio-scroll"
          @scroll.passive="onPanelScroll"
        >
          <!-- 暖燕麦色当前状态主卡 -->
          <div class="oat-hero-well scroll-reactive">
            <div ref="pebbleRef" class="oat-hero-pebble" aria-hidden="true" />
            <div class="oat-eyebrow-row">
              <span class="oat-eyebrow">
                {{
                  isCreatingNewPreset
                    ? '正在新建预设'
                    : `当前选中 · ${editingSteps.length} 步动作`
                }}
              </span>
              <Transition name="hero-badge-pop" mode="out-in">
                <span
                  :key="currentPresetBadgeText + '-' + isCurrentPresetPinned"
                  class="oat-mode-pill"
                  :class="{ pinned: isCurrentPresetPinned }"
                >
                  {{ currentPresetBadgeText }}
                </span>
              </Transition>
            </div>

            <Transition name="hero-title-flip" mode="out-in">
              <div
                :key="activePresetId + (isCreatingNewPreset ? '-new' : '')"
                class="oat-hero-title-wrap"
              >
                <div class="oat-hero-title">
                  {{ customPresetName || (isCreatingNewPreset ? '未命名新预设' : '日常待机') }}
                </div>
                <div v-if="currentSelectedPreset?.description" class="oat-hero-desc">
                  {{ currentSelectedPreset.description }}
                </div>
              </div>
            </Transition>

            <div v-if="displayMode === 'live2d'" class="oat-hero-actions">
              <button
                type="button"
                class="bio-btn-pill accent pressable"
                @click="openStudioForCurrentPreset"
              >
                进入预设工坊
              </button>
              <button
                v-if="currentSelectedPreset"
                type="button"
                class="bio-btn-pill pressable"
                :class="{ pinned: isCurrentPresetPinned }"
                :title="
                  isCurrentPresetPinned
                    ? '点击取消常驻（恢复默认待机回退基准，当前选中卡片不跳走）'
                    : '将该预设钉为常驻基准（其他「播完恢复」预设演完后将回到此状态）'
                "
                @click="togglePinPreset(currentSelectedPreset)"
              >
                {{ isCurrentPresetPinned ? '已钉为常驻 ×' : '钉为常驻' }}
              </button>
              <button
                v-if="currentSelectedPreset && statePresets.length > 1"
                type="button"
                class="bio-btn-pill danger pressable"
                title="删除当前选中的预设"
                @click="removeCustomPreset(currentSelectedPreset.id)"
              >
                删除
              </button>
            </div>
          </div>

          <!-- 状态预设：默认双列小胶囊，点击展开组内变体卡片 -->
          <div class="bio-section scroll-reactive">
            <div class="bio-sec-head">
              <span class="bio-sec-label">
                状态预设 ({{ groupedStatePresets.length }}组 · {{ statePresets.length }}项)
              </span>
              <div class="bio-sec-links">
                <button
                  type="button"
                  class="bio-sec-link pressable"
                  title="恢复模型默认初始预设"
                  @click="onRestoreDefaultPresets"
                >
                  恢复初始
                </button>
                <span class="bio-sec-dot">·</span>
                <button
                  type="button"
                  class="bio-sec-link pressable"
                  title="将所有开关与滑块还原为模型默认状态"
                  @click="resetAllControls"
                >
                  清空还原
                </button>
              </div>
            </div>

            <div class="preset-rows-stack">
              <div
                v-for="(row, rIdx) in presetGridRows"
                :key="rIdx"
                class="preset-row-block"
              >
                <div class="preset-capsule-grid">
                  <template v-for="slot in row" :key="slot.kind === 'group' ? slot.grp.group : '__add_new__'">
                    <div
                      v-if="slot.kind === 'group'"
                      class="preset-capsule group-capsule pressable cascade-item"
                      :class="{
                        active: isGroupActive(slot.grp),
                        pinned: isGroupPinned(slot.grp),
                        'drawer-open': expandedGroupName === slot.grp.group,
                      }"
                      :style="{ '--stagger-i': Math.min(slot.gIdx, 10) }"
                      :title="slot.grp.items[0]?.description || slot.grp.group"
                      @click="onGroupCapsuleClick(slot.grp, slot.gIdx)"
                    >
                      <button
                        type="button"
                        class="capsule-expand-btn"
                        :class="{ open: expandedGroupName === slot.grp.group }"
                        :title="
                          expandedGroupName === slot.grp.group
                            ? `收起「${slot.grp.group}」分组变体`
                            : `展开「${slot.grp.group}」分组变体（共 ${slot.grp.items.length} 项）`
                        "
                        @click.stop="toggleExpandGroup(slot.grp.group, rIdx, slot.gIdx)"
                      >
                        <svg viewBox="0 0 24 24">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </button>
                      <span class="preset-capsule-name">{{ slot.grp.group }}</span>
                      <div class="preset-capsule-meta">
                        <span
                          v-if="slot.grp.items.length > 1"
                          class="preset-step-tag"
                          :title="`点击展开 ${slot.grp.items.length} 个变体`"
                          @click.stop="toggleExpandGroup(slot.grp.group, rIdx, slot.gIdx)"
                        >
                          {{ slot.grp.items.length }}
                        </span>
                        <span
                          v-else-if="(slot.grp.items[0]?.steps?.length ?? 1) > 1"
                          class="preset-step-tag"
                        >
                          {{ slot.grp.items[0]?.steps?.length }}步
                        </span>
                        <button
                          v-if="displayMode === 'live2d'"
                          type="button"
                          class="capsule-pin-btn"
                          :class="{ active: isGroupPinned(slot.grp) }"
                          :title="
                            isGroupPinned(slot.grp)
                              ? '已钉为常驻基准（点击取消常驻）'
                              : '将该组默认预设钉为常驻保持基准'
                          "
                          @click.stop="togglePinGroup(slot.grp, slot.gIdx)"
                        >
                          <svg viewBox="0 0 24 24">
                            <path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 1 1 0 0 1 1 1z" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <button
                      v-else
                      type="button"
                      class="preset-capsule add-new pressable cascade-item"
                      :style="{ '--stagger-i': Math.min(groupedStatePresets.length, 10) }"
                      title="新建一个自定义状态与多步动作预设"
                      @click="startNewPreset()"
                    >
                      <span class="preset-capsule-name">+ 新建预设</span>
                    </button>
                  </template>
                </div>

                <!-- 行下方的弹簧手风琴变体抽屉（0fr <-> 1fr 双向物理过渡） -->
                <div
                  class="group-drawer-collapse"
                  :class="{ open: isRowDrawerOpen(row) }"
                >
                  <div class="group-drawer-inner">
                    <div
                      v-if="getRowDrawerGroup(row, rIdx)"
                      :key="getRowDrawerGroup(row, rIdx)!.grp.group"
                      class="preset-group-card"
                    >
                      <div class="preset-group-head">
                        <div
                          class="preset-group-title-wrap"
                          title="点击收起分组变体"
                          @click="toggleExpandGroup(getRowDrawerGroup(row, rIdx)!.grp.group, rIdx, getRowDrawerGroup(row, rIdx)!.gIdx)"
                        >
                          <span class="preset-group-name">{{ getRowDrawerGroup(row, rIdx)!.grp.group }}</span>
                          <span class="preset-group-count">{{ getRowDrawerGroup(row, rIdx)!.grp.items.length }}项</span>
                        </div>
                        <div class="preset-group-actions">
                          <button
                            v-if="getRowDrawerGroup(row, rIdx)!.grp.items.length > 1"
                            type="button"
                            class="preset-group-btn rand pressable"
                            :title="`在「${getRowDrawerGroup(row, rIdx)!.grp.group}」组内随机抽取一个预设演出（防连续重复）`"
                            @click="triggerRandomInGroup(getRowDrawerGroup(row, rIdx)!.grp.group, getRowDrawerGroup(row, rIdx)!.gIdx)"
                          >
                            随机抽取
                          </button>
                          <button
                            v-if="displayMode === 'live2d'"
                            type="button"
                            class="preset-group-btn pressable"
                            :title="`在「${getRowDrawerGroup(row, rIdx)!.grp.group}」组下新建一个变体预设`"
                            @click="startNewPreset(getRowDrawerGroup(row, rIdx)!.grp.group, getRowDrawerGroup(row, rIdx)!.grp.emotion)"
                          >
                            + 变体
                          </button>
                          <button
                            type="button"
                            class="preset-group-btn pressable"
                            title="收起当前分组"
                            @click="toggleExpandGroup(getRowDrawerGroup(row, rIdx)!.grp.group, rIdx, getRowDrawerGroup(row, rIdx)!.gIdx)"
                          >
                            收起
                          </button>
                        </div>
                      </div>

                      <div class="preset-capsule-grid">
                        <div
                          v-for="(preset, idx) in getRowDrawerGroup(row, rIdx)!.grp.items"
                          :key="preset.id"
                          class="preset-capsule inner-variant pressable"
                          :class="{
                            active: !isCreatingNewPreset && activePresetId === preset.id,
                            pinned: store.activeHoldPresetId === preset.id,
                          }"
                          :style="{ '--variant-i': idx }"
                          :title="preset.description || preset.label"
                          @click="applyStatePreset(preset, idx)"
                        >
                          <span class="preset-capsule-name">
                            {{ formatGroupPresetLabel(preset, getRowDrawerGroup(row, rIdx)!.grp.group) }}
                          </span>
                          <div class="preset-capsule-meta">
                            <span
                              v-if="(preset.steps?.length ?? 1) > 1"
                              class="preset-step-tag"
                            >
                              {{ preset.steps?.length }}步
                            </span>
                            <button
                              v-if="displayMode === 'live2d'"
                              type="button"
                              class="capsule-pin-btn"
                              :class="{ active: store.activeHoldPresetId === preset.id }"
                              :title="
                                store.activeHoldPresetId === preset.id
                                  ? '已钉为常驻基准（点击取消常驻）'
                                  : '钉为常驻保持基准'
                              "
                              @click.stop="togglePinPreset(preset, idx)"
                            >
                              <svg viewBox="0 0 24 24">
                                <path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 1 1 0 0 1 1 1z" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            v-if="displayMode !== 'live2d'"
            class="oat-well scroll-reactive"
          >
            <span class="oat-eyebrow">静态立绘模式</span>
            <p class="bio-hint">
              当前为静态立绘模式，点击上方胶囊可立即切换立绘表情。切换至 Live2D 模型后可解锁「预设工坊」编排多步分镜、部件穿搭与五官微调。
            </p>
          </div>
        </div>

        <!-- ==================== 页签 2：预设工坊（全折叠分组菜单：分镜保存 + 分类部件框 + 面捕滑块） ==================== -->
        <div
          v-else-if="activeTab === 'studio' && displayMode === 'live2d'"
          key="studio"
          class="bio-scroll"
          @scroll.passive="onPanelScroll"
        >
          <!-- 折叠组 1：预设分镜与保存 -->
          <div class="bio-fold-card scroll-reactive cascade-item" style="--stagger-i: 0" :class="{ open: expandedSections.sequence }">
            <div class="bio-fold-head" @click="toggleSection('sequence')">
              <div class="bio-fold-title-wrap">
                <svg class="bio-fold-arrow" viewBox="0 0 24 24">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <span class="bio-fold-title">预设分镜与保存</span>
                <span class="bio-fold-badge accent">
                  {{ isCreatingNewPreset ? '新建中' : `${editingSteps.length}步` }}
                </span>
              </div>
              <div class="bio-fold-right">
                <span class="bio-fold-badge">{{ finishModeShortLabel }}</span>
              </div>
            </div>

            <div class="bio-fold-collapse" :class="{ open: expandedSections.sequence }">
              <div class="bio-fold-inner">
                <div class="bio-fold-body">
                  <!-- 第 1 行：步骤序列条 + 新增步骤 -->
                  <div class="pebble-seq-row">
                    <button
                      v-for="(step, idx) in editingSteps"
                      :key="idx"
                      type="button"
                      class="seq-pebble pressable"
                      :class="{ active: editingStepIndex === idx }"
                      @click="selectEditingStep(idx)"
                    >
                      0{{ idx + 1 }} · {{ step.label || `步骤 ${idx + 1}` }} ({{ formatStepSec(step.durationMs) }}s)
                    </button>
                    <button
                      type="button"
                      class="seq-pebble add-step pressable"
                      title="复制当前步骤姿势并新增下一步"
                      @click="addEditingStep"
                    >
                      + 步骤
                    </button>
                  </div>

                  <!-- 第 2 行：当前步骤名称 + 过渡/停留时间 + 删步 -->
                  <div class="studio-timing-row">
                    <input
                      v-model="currentEditingStep.label"
                      class="bio-pill-input step-label-input"
                      :placeholder="`步骤 ${editingStepIndex + 1}`"
                      maxlength="10"
                    />
                    <label class="bio-time-chip" title="从上一步平滑过渡到本步骤的耗时（秒）">
                      <span>过渡</span>
                      <input
                        type="number"
                        min="0.05"
                        max="5"
                        step="0.05"
                        :value="formatStepSec(currentEditingStep.durationMs)"
                        @change="onStepDurationChange"
                      />
                      <span>s</span>
                    </label>
                    <label class="bio-time-chip" title="到达本步骤姿势后的停留时间（秒）">
                      <span>停留</span>
                      <input
                        type="number"
                        min="0"
                        max="5"
                        step="0.05"
                        :value="formatStepSec(currentEditingStep.holdMs)"
                        @change="onStepHoldChange"
                      />
                      <span>s</span>
                    </label>
                    <button
                      v-if="editingSteps.length > 1"
                      type="button"
                      class="bio-del-step-btn pressable"
                      title="删除当前分镜步骤"
                      @click="removeCurrentEditingStep"
                    >
                      删步
                    </button>
                  </div>

                  <!-- 第 3 行：收尾方式三选一 -->
                  <div class="studio-mode-strip">
                    <button
                      type="button"
                      class="studio-mode-btn pressable"
                      :class="{ active: editingFinishMode === 'revert' }"
                      @click="editingFinishMode = 'revert'"
                    >
                      播完恢复
                    </button>
                    <button
                      type="button"
                      class="studio-mode-btn pressable"
                      :class="{ active: editingFinishMode === 'hold' }"
                      @click="editingFinishMode = 'hold'"
                    >
                      持续保持
                    </button>
                    <button
                      type="button"
                      class="studio-mode-btn pressable"
                      :class="{ active: editingFinishMode === 'loop' }"
                      @click="editingFinishMode = 'loop'"
                    >
                      循环往复
                    </button>
                  </div>

                  <!-- 第 4 行：所属情绪分组（后端按情绪/分组名调用时会在同组预设中随机抽取） -->
                  <div class="studio-group-block">
                    <div class="studio-group-chips">
                      <button
                        v-for="g in PRESET_EMOTION_GROUPS"
                        :key="g.group"
                        type="button"
                        class="studio-group-chip pressable"
                        :class="{ active: editingGroup === g.group }"
                        @click="selectPresetGroupOption(g.group, g.emotion)"
                      >
                        {{ g.group }}
                      </button>
                    </div>
                  </div>

                  <!-- 第 5 行：所属分组名 + 预设名称输入 -->
                  <div class="studio-name-row">
                    <input
                      v-model="editingGroup"
                      class="bio-pill-input group-name-input"
                      placeholder="分组名(如 开心)"
                      maxlength="10"
                      title="所属情绪分组名（同组多个预设供后端随机抽取）"
                    />
                    <input
                      ref="presetNameInputRef"
                      v-model="customPresetName"
                      class="bio-pill-input preset-name-input"
                      :placeholder="isCreatingNewPreset ? '输入预设名称(如 开心·歪头笑)...' : '输入预设名称（同名保存即覆盖）...'"
                      maxlength="18"
                      @keydown.enter.prevent="saveCurrentCombo"
                    />
                  </div>

                  <!-- 第 5 行：独立操作栏（预览 / 取消 / 保存，单独成行绝不挤换行） -->
                  <div class="studio-action-row">
                    <button
                      type="button"
                      class="bio-btn-pill clay pressable"
                      title="从第 1 步到最后一步完整预览连续动画"
                      @click="previewEditingSequence"
                    >
                      ▶ 预览序列
                    </button>
                    <button
                      v-if="isCreatingNewPreset"
                      type="button"
                      class="bio-btn-pill pressable"
                      title="取消新建并回到上一个预设"
                      @click="cancelNewPreset"
                    >
                      取消新建
                    </button>
                    <button
                      type="button"
                      class="bio-btn-pill accent save-main-btn pressable"
                      :disabled="!customPresetName.trim()"
                      @click="saveCurrentCombo"
                    >
                      {{ saveButtonLabel }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 折叠组 2：可选部件（按分类加框分组，智能跨列胶囊） -->
          <div
            v-if="totalControlsCount > 0"
            class="bio-fold-card scroll-reactive cascade-item"
            style="--stagger-i: 1"
            :class="{ open: expandedSections.controls }"
          >
            <div class="bio-fold-head" @click="toggleSection('controls')">
              <div class="bio-fold-title-wrap">
                <svg class="bio-fold-arrow" viewBox="0 0 24 24">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <span class="bio-fold-title">可选部件</span>
                <span
                  class="bio-fold-badge"
                  :class="{ accent: activeStepControlsCount > 0 }"
                >
                  已开 {{ activeStepControlsCount }}/{{ totalControlsCount }}
                </span>
              </div>
              <div class="bio-fold-right" @click.stop>
                <button
                  type="button"
                  class="bio-sec-link pressable"
                  title="重置临时表情与手势部件（保留常驻服装与发型）"
                  @click="resetTransientControls"
                >
                  重置部件
                </button>
              </div>
            </div>

            <div class="bio-fold-collapse" :class="{ open: expandedSections.controls }">
              <div class="bio-fold-inner">
                <div class="bio-fold-body">
                  <div
                    v-for="group in controlGroups"
                    :key="group.category"
                    class="ctrl-group-box"
                  >
                    <div class="ctrl-group-header">
                      <span class="ctrl-group-title">{{ group.label }}</span>
                      <span class="ctrl-group-count">
                        {{ group.activeCount }}/{{ group.items.length }}
                      </span>
                    </div>
                    <div class="ctrl-capsule-grid">
                      <button
                        v-for="ctrl in group.items"
                        :key="ctrl.id"
                        type="button"
                        class="ctrl-capsule pressable"
                        :class="{
                          active: isStepControlActive(ctrl.id),
                          'full-row': shouldSpanFullRow(ctrl, group.items.length),
                        }"
                        :title="ctrl.label"
                        @click="toggleSingleControl(ctrl.id)"
                      >
                        <span class="ctrl-dot" />
                        <span class="ctrl-name">{{ formatControlLabel(ctrl.label) }}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 折叠组 3：五官与眼神 -->
          <div
            v-if="faceSliders.length > 0"
            class="bio-fold-card scroll-reactive cascade-item"
            style="--stagger-i: 2"
            :class="{ open: expandedSections.face }"
          >
            <div class="bio-fold-head" @click="toggleSection('face')">
              <div class="bio-fold-title-wrap">
                <svg class="bio-fold-arrow" viewBox="0 0 24 24">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <span class="bio-fold-title">五官与眼神</span>
                <span
                  class="bio-fold-badge"
                  :class="{ accent: modifiedFaceSliderCount > 0 }"
                >
                  {{
                    modifiedFaceSliderCount > 0
                      ? `已改 ${modifiedFaceSliderCount}`
                      : `${faceSliders.length}项`
                  }}
                </span>
              </div>
              <div class="bio-fold-right" @click.stop>
                <button
                  type="button"
                  class="bio-sec-link pressable"
                  @click="resetSlidersByGroup('face')"
                >
                  归零
                </button>
              </div>
            </div>

            <div class="bio-fold-collapse" :class="{ open: expandedSections.face }">
              <div class="bio-fold-inner">
                <div class="bio-fold-body">
                  <div class="bio-slider-list">
                    <div
                      v-for="slider in faceSliders"
                      :key="slider.id"
                      class="bio-scrub"
                    >
                      <div
                        class="bio-scrub-fill"
                        :style="{ left: '0%', width: getSliderFillPercent(slider) + '%' }"
                      />
                      <span class="bio-scrub-label">{{ slider.label }}</span>
                      <button
                        type="button"
                        class="bio-scrub-val"
                        :class="{ modified: isStepSliderModified(slider) }"
                        title="点击数值复位该参数"
                        @click="resetSingleSlider(slider)"
                      >
                        {{ formatSliderValue(getStepSliderValue(slider), slider.step) }}{{ isStepSliderModified(slider) ? ' ↺' : '' }}
                      </button>
                      <input
                        type="range"
                        class="bio-range-input"
                        :min="slider.min"
                        :max="slider.max"
                        :step="slider.step"
                        :value="getStepSliderValue(slider)"
                        @input="onSliderInput(slider, $event)"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 折叠组 4：头部与身体姿态 -->
          <div
            v-if="poseSliders.length > 0"
            class="bio-fold-card scroll-reactive cascade-item"
            style="--stagger-i: 3"
            :class="{ open: expandedSections.pose }"
          >
            <div class="bio-fold-head" @click="toggleSection('pose')">
              <div class="bio-fold-title-wrap">
                <svg class="bio-fold-arrow" viewBox="0 0 24 24">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <span class="bio-fold-title">头部与身体姿态</span>
                <span
                  class="bio-fold-badge"
                  :class="{ accent: modifiedPoseSliderCount > 0 }"
                >
                  {{
                    modifiedPoseSliderCount > 0
                      ? `已改 ${modifiedPoseSliderCount}`
                      : `${poseSliders.length}项`
                  }}
                </span>
              </div>
              <div class="bio-fold-right" @click.stop>
                <button
                  type="button"
                  class="bio-sec-link pressable"
                  @click="resetSlidersByGroup('pose')"
                >
                  归零
                </button>
              </div>
            </div>

            <div class="bio-fold-collapse" :class="{ open: expandedSections.pose }">
              <div class="bio-fold-inner">
                <div class="bio-fold-body">
                  <div class="bio-slider-list">
                    <div
                      v-for="slider in poseSliders"
                      :key="slider.id"
                      class="bio-scrub"
                    >
                      <div
                        class="bio-scrub-fill"
                        :style="{ left: '0%', width: getSliderFillPercent(slider) + '%' }"
                      />
                      <span class="bio-scrub-label">{{ slider.label }}</span>
                      <button
                        type="button"
                        class="bio-scrub-val"
                        :class="{ modified: isStepSliderModified(slider) }"
                        title="点击数值复位该参数"
                        @click="resetSingleSlider(slider)"
                      >
                        {{ formatSliderValue(getStepSliderValue(slider), slider.step) }}{{ isStepSliderModified(slider) ? ' ↺' : '' }}
                      </button>
                      <input
                        type="range"
                        class="bio-range-input"
                        :min="slider.min"
                        :max="slider.max"
                        :step="slider.step"
                        :value="getStepSliderValue(slider)"
                        @input="onSliderInput(slider, $event)"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 折叠组 5：更多物理参数 -->
          <div
            v-if="extraSliders.length > 0"
            class="bio-fold-card scroll-reactive cascade-item"
            style="--stagger-i: 4"
            :class="{ open: expandedSections.extra }"
          >
            <div class="bio-fold-head" @click="toggleSection('extra')">
              <div class="bio-fold-title-wrap">
                <svg class="bio-fold-arrow" viewBox="0 0 24 24">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <span class="bio-fold-title">更多物理参数</span>
                <span
                  class="bio-fold-badge"
                  :class="{ accent: modifiedExtraSliderCount > 0 }"
                >
                  {{
                    modifiedExtraSliderCount > 0
                      ? `已改 ${modifiedExtraSliderCount}`
                      : `${extraSliders.length}项`
                  }}
                </span>
              </div>
              <div class="bio-fold-right" @click.stop>
                <button
                  type="button"
                  class="bio-sec-link pressable"
                  @click="resetSlidersByGroup('extra')"
                >
                  归零
                </button>
              </div>
            </div>

            <div class="bio-fold-collapse" :class="{ open: expandedSections.extra }">
              <div class="bio-fold-inner">
                <div class="bio-fold-body">
                  <div class="bio-slider-list">
                    <div
                      v-for="slider in extraSliders"
                      :key="slider.id"
                      class="bio-scrub"
                    >
                      <div
                        class="bio-scrub-fill"
                        :style="{ left: '0%', width: getSliderFillPercent(slider) + '%' }"
                      />
                      <span class="bio-scrub-label">{{ slider.label }}</span>
                      <button
                        type="button"
                        class="bio-scrub-val"
                        :class="{ modified: isStepSliderModified(slider) }"
                        title="点击数值复位该参数"
                        @click="resetSingleSlider(slider)"
                      >
                        {{ formatSliderValue(getStepSliderValue(slider), slider.step) }}{{ isStepSliderModified(slider) ? ' ↺' : '' }}
                      </button>
                      <input
                        type="range"
                        class="bio-range-input"
                        :min="slider.min"
                        :max="slider.max"
                        :step="slider.step"
                        :value="getStepSliderValue(slider)"
                        @input="onSliderInput(slider, $event)"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ==================== 页签 3：面板设置（外观取色、模型、连接与热键） ==================== -->
        <div
          v-else
          key="settings"
          class="bio-scroll"
          @scroll.passive="onPanelScroll"
        >
          <!-- 1. 外观模式与自定义取色 -->
          <div class="oat-well scroll-reactive cascade-item" style="--stagger-i: 0">
            <div class="oat-eyebrow-row">
              <span class="oat-eyebrow">外观与主题配色</span>
            </div>

            <div class="studio-mode-strip">
              <button
                type="button"
                class="studio-mode-btn pressable"
                :class="{ active: store.themeMode === 'light' }"
                @click="store.themeMode = 'light'"
              >
                日间模式
              </button>
              <button
                type="button"
                class="studio-mode-btn pressable"
                :class="{ active: store.themeMode === 'dark' }"
                @click="store.themeMode = 'dark'"
              >
                夜间模式
              </button>
            </div>

            <div class="swatch-bar">
              <button
                v-for="preset in THEME_ACCENT_PRESETS"
                :key="preset.color"
                type="button"
                class="swatch-dot pressable"
                :class="{ active: store.accentColor.toLowerCase() === preset.color.toLowerCase() }"
                :style="{ background: preset.color }"
                :title="preset.name"
                @click="store.accentColor = preset.color"
              />
              <label class="custom-color-pill pressable" title="打开系统调色盘自由取色">
                <input
                  type="color"
                  :value="store.accentColor"
                  @input="onAccentColorInput"
                />
                <span class="custom-color-preview" :style="{ background: store.accentColor }" />
                <span>自定义取色</span>
              </label>
            </div>

            <label class="bio-field-label">窗口交互开关</label>
            <div class="ctrl-capsule-grid">
              <button
                type="button"
                class="ctrl-capsule pressable"
                :class="{ active: store.hoverFadeEnabled }"
                title="鼠标移入桌宠窗口时自动降低不透明度"
                @click="store.hoverFadeEnabled = !store.hoverFadeEnabled"
              >
                <span class="ctrl-dot" />
                <span class="ctrl-name">悬停半透明</span>
                <span class="ctrl-state-tag">{{ store.hoverFadeEnabled ? '已开' : '已关' }}</span>
              </button>
              <button
                type="button"
                class="ctrl-capsule pressable"
                :class="{ active: store.clickThroughLocked }"
                title="开启后鼠标点击直接穿透桌宠窗口（可在系统托盘解除）"
                @click="toggleClickThroughLock"
              >
                <span class="ctrl-dot" />
                <span class="ctrl-name">鼠标穿透</span>
                <span class="ctrl-state-tag">{{ store.clickThroughLocked ? '已开' : '已关' }}</span>
              </button>
            </div>

            <label class="bio-field-label">左上角圆点快捷功能</label>
            <div class="ctrl-capsule-grid">
              <button
                type="button"
                class="ctrl-capsule pressable"
                :class="{ active: store.orbAction === 'model_picker' }"
                @click="store.orbAction = 'model_picker'"
              >
                <span class="ctrl-dot" />
                <span class="ctrl-name">呼出模型栏</span>
              </button>
              <button
                type="button"
                class="ctrl-capsule pressable"
                :class="{ active: store.orbAction === 'toggle_display_mode' }"
                @click="store.orbAction = 'toggle_display_mode'"
              >
                <span class="ctrl-dot" />
                <span class="ctrl-name">切立绘/L2D</span>
              </button>
              <button
                type="button"
                class="ctrl-capsule pressable"
                :class="{ active: store.orbAction === 'color_picker' }"
                @click="store.orbAction = 'color_picker'"
              >
                <span class="ctrl-dot" />
                <span class="ctrl-name">打开调色盘</span>
              </button>
              <button
                type="button"
                class="ctrl-capsule pressable"
                :class="{ active: store.orbAction === 'toggle_theme' }"
                @click="store.orbAction = 'toggle_theme'"
              >
                <span class="ctrl-dot" />
                <span class="ctrl-name">切换日夜间</span>
              </button>
            </div>
          </div>

          <!-- 2. 展示模式与模型包 -->
          <div class="oat-well scroll-reactive cascade-item" style="--stagger-i: 1">
            <div class="oat-eyebrow-row">
              <span class="oat-eyebrow">展示模式与模型</span>
              <span class="bio-fold-badge">{{ filteredModels.length }} 个可用</span>
            </div>

            <div class="studio-mode-strip">
              <button
                type="button"
                class="studio-mode-btn pressable"
                :class="{ active: displayMode === 'live2d' }"
                :disabled="switching || !models.some((m) => m.kind === 'live2d')"
                @click="setDisplayMode('live2d')"
              >
                Live2D 模型
              </button>
              <button
                type="button"
                class="studio-mode-btn pressable"
                :class="{ active: displayMode === 'image-set' }"
                :disabled="switching || !models.some((m) => m.kind === 'image-set')"
                @click="setDisplayMode('image-set')"
              >
                静态立绘
              </button>
            </div>

            <!-- 自定义有机展开模型选择列表 -->
            <div class="bio-model-picker" :class="{ open: settingsModelListOpen }">
              <button
                type="button"
                class="bio-model-trigger pressable"
                :disabled="switching"
                @click="settingsModelListOpen = !settingsModelListOpen"
              >
                <span class="ctrl-dot active-dot" />
                <span class="bio-model-trigger-name">{{ currentModelDisplayName }}</span>
                <svg class="bio-fold-arrow" viewBox="0 0 24 24">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>

              <div class="bio-fold-collapse" :class="{ open: settingsModelListOpen }">
                <div class="bio-fold-inner">
                  <div class="bio-model-list settings-model-list">
                    <div v-if="filteredModels.length === 0" class="bio-model-empty">
                      未发现{{ displayMode === 'live2d' ? ' Live2D 模型' : '静态立绘包' }}
                    </div>
                    <button
                      v-for="m in filteredModels"
                      :key="m.url"
                      type="button"
                      class="bio-model-item pressable"
                      :class="{ active: selectedModel === m.url }"
                      :disabled="switching"
                      @click="selectModelUrl(m.url)"
                    >
                      <span class="ctrl-dot" />
                      <span class="bio-model-item-name">{{ m.name }}</span>
                      <span v-if="selectedModel === m.url" class="bio-model-item-tag">当前</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div class="oat-hero-actions">
              <button
                type="button"
                class="bio-btn-pill pressable"
                :disabled="switching"
                @click="rescan"
              >
                刷新列表
              </button>
              <button
                type="button"
                class="bio-btn-pill pressable"
                @click="openModelsFolder"
              >
                模型目录
              </button>
              <button
                type="button"
                class="bio-btn-pill pressable"
                @click="reload"
              >
                重载窗口
              </button>
            </div>
          </div>

          <!-- 3. 后台服务管理 -->
          <div class="oat-well scroll-reactive cascade-item" style="--stagger-i: 2">
            <ServicesSection />
          </div>

          <!-- 4. 连接、语音与自动截图 -->
          <div class="oat-well scroll-reactive cascade-item" style="--stagger-i: 3">
            <div class="oat-eyebrow-row">
              <span class="oat-eyebrow">连接与语音热键</span>
            </div>

            <label class="bio-field-label">MaiBot WS 地址</label>
            <input
              class="bio-pill-input full"
              :value="wsUrl"
              placeholder="ws://127.0.0.1:8523/ws"
              @change="setWsUrl"
            />

            <label class="bio-field-label">连接密钥 Token（可选）</label>
            <input
              class="bio-pill-input full"
              type="password"
              :value="wsToken"
              placeholder="留空则不鉴权"
              @change="setWsToken"
            />

            <label class="bio-field-label">语音识别 STT 地址</label>
            <input
              class="bio-pill-input full"
              :value="sttUrl"
              placeholder="http://127.0.0.1:18530/stt"
              @change="setSttUrl"
            />

            <div class="bio-grid-2">
              <div>
                <label class="bio-field-label">热键模式</label>
                <select class="bio-select" :value="pttMode" @change="setPttMode">
                  <option value="ptt">按住说话</option>
                  <option value="toggle">按一下开/关</option>
                </select>
              </div>
              <div>
                <label class="bio-field-label">快捷键</label>
                <select class="bio-select" :value="pttKey" @change="setPttKey">
                  <option value="f9">F9</option>
                  <option value="f8">F8</option>
                  <option value="f7">F7</option>
                  <option value="f6">F6</option>
                  <option value="capslock">CapsLock</option>
                  <option value="ralt">右 Alt</option>
                  <option value="rctrl">右 Ctrl</option>
                  <option value="mouse4">鼠标侧键 4</option>
                  <option value="mouse5">鼠标侧键 5</option>
                </select>
              </div>
            </div>

            <div class="bio-grid-2">
              <div>
                <label class="bio-field-label">VAD 阈值</label>
                <input
                  class="bio-pill-input full"
                  type="number"
                  min="0.005"
                  max="0.2"
                  step="0.005"
                  :value="vadThreshold"
                  @change="setVadThreshold"
                />
              </div>
              <div>
                <label class="bio-field-label">静音断句 (秒)</label>
                <input
                  class="bio-pill-input full"
                  type="number"
                  min="0.5"
                  max="5"
                  step="0.1"
                  :value="vadSilence"
                  @change="setVadSilence"
                />
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import ServicesSection from './ServicesSection.vue'
import {
  listAvailableModels,
  getStoredModelPath,
  kindOfModelUrl,
  type ModelKind,
} from '@/services/live2d/model-discovery'
import {
  PRESET_EMOTION_GROUPS,
  applyControlActionToList,
  getPresetDefaultFinishMode,
  isPersistentControlCategory,
  normalizePresetSteps,
  pickRandomPresetInGroup,
  resolvePresetGroup,
  type ModelStatePreset,
  type PresetFinishMode,
  type PresetKeyframeStep,
  type ResolvedModelControl,
  type ResolvedModelSlider,
} from '@/services/live2d/emotion-adapter'
import { useDeskpetStore, THEME_ACCENT_PRESETS } from '@/stores/deskpet'

const props = withDefaults(
  defineProps<{
    open: boolean
    popDirectionX?: 'left' | 'right'
    alignY?: 'bottom' | 'top'
  }>(),
  {
    popDirectionX: 'left',
    alignY: 'bottom',
  },
)
defineEmits<{ close: [] }>()

const store = useDeskpetStore()
const companionRootRef = ref<HTMLElement | null>(null)
const navBarRef = ref<HTMLElement | null>(null)
const orbBtnRef = ref<HTMLElement | null>(null)
const pebbleRef = ref<HTMLElement | null>(null)
const activeTab = ref<'states' | 'studio' | 'settings'>('states')
const activePresetId = ref('neutral')
const previousPresetId = ref('neutral')
const isCreatingNewPreset = ref(false)
const customPresetName = ref('')
const presetNameInputRef = ref<HTMLInputElement | null>(null)

/** 预设工坊内各模块的展开/收起状态 */
const expandedSections = reactive({
  sequence: true,
  controls: true,
  face: true,
  pose: false,
  extra: false,
})

function toggleSection(key: keyof typeof expandedSections) {
  expandedSections[key] = !expandedSections[key]
}

const editingSteps = ref<PresetKeyframeStep[]>([
  { label: '步骤 1', durationMs: 600, holdMs: 0, controls: [], parameters: {} },
])
const editingStepIndex = ref(0)
const editingFinishMode = ref<PresetFinishMode>('revert')
const editingEmotion = ref('neutral')
const editingGroup = ref('日常待机')
const editingMotion = ref<{ group: string; index?: number } | 'none' | undefined>(undefined)

const currentEditingStep = computed<PresetKeyframeStep>(() => {
  const idx = Math.max(0, Math.min(editingSteps.value.length - 1, editingStepIndex.value))
  return (
    editingSteps.value[idx] ?? {
      label: '步骤 1',
      durationMs: 600,
      holdMs: 0,
      controls: [],
      parameters: {},
    }
  )
})

const statePresets = computed(() => store.statePresets)
const expandedGroupName = ref('')
const lastDrawerGroupByRow = reactive<Record<number, string>>({})

type PresetGroupBucket = { group: string; emotion: string; items: ModelStatePreset[] }
type PresetGridSlot =
  | { kind: 'group'; grp: PresetGroupBucket; gIdx: number }
  | { kind: 'add-new' }

const groupedStatePresets = computed<PresetGroupBucket[]>(() => {
  const map = new Map<string, PresetGroupBucket>()
  for (const preset of statePresets.value) {
    const groupName = resolvePresetGroup(preset)
    let bucket = map.get(groupName)
    if (!bucket) {
      bucket = {
        group: groupName,
        emotion: preset.emotion || 'neutral',
        items: [],
      }
      map.set(groupName, bucket)
    }
    bucket.items.push(preset)
  }
  return Array.from(map.values())
})

const presetGridRows = computed<PresetGridSlot[][]>(() => {
  const slots: PresetGridSlot[] = groupedStatePresets.value.map((grp, gIdx) => ({
    kind: 'group',
    grp,
    gIdx,
  }))
  if (displayMode.value === 'live2d') {
    slots.push({ kind: 'add-new' })
  }
  const rows: PresetGridSlot[][] = []
  for (let i = 0; i < slots.length; i += 2) {
    rows.push(slots.slice(i, i + 2))
  }
  return rows
})

function isRowDrawerOpen(row: PresetGridSlot[]): boolean {
  if (!expandedGroupName.value) return false
  return row.some((s) => s.kind === 'group' && s.grp.group === expandedGroupName.value)
}

function getRowDrawerGroup(
  row: PresetGridSlot[],
  rIdx: number,
): { grp: PresetGroupBucket; gIdx: number } | null {
  const groupSlots = row.filter(
    (s): s is { kind: 'group'; grp: PresetGroupBucket; gIdx: number } => s.kind === 'group',
  )
  if (groupSlots.length === 0) return null
  if (expandedGroupName.value) {
    const activeHit = groupSlots.find((s) => s.grp.group === expandedGroupName.value)
    if (activeHit) return activeHit
  }
  const remembered = lastDrawerGroupByRow[rIdx]
  if (remembered) {
    const rememberedHit = groupSlots.find((s) => s.grp.group === remembered)
    if (rememberedHit) return rememberedHit
  }
  return groupSlots[0]
}

function isGroupActive(grp: { group: string; items: ModelStatePreset[] }): boolean {
  return !isCreatingNewPreset.value && grp.items.some((p) => p.id === activePresetId.value)
}

function isGroupPinned(grp: { group: string; items: ModelStatePreset[] }): boolean {
  return (
    store.activeHoldPresetId !== '' &&
    grp.items.some((p) => p.id === store.activeHoldPresetId)
  )
}

function toggleExpandGroup(groupName: string, rIdx?: number, gIdx?: number) {
  if (typeof rIdx === 'number') {
    lastDrawerGroupByRow[rIdx] = groupName
  }
  const isClosing = expandedGroupName.value === groupName
  expandedGroupName.value = isClosing ? '' : groupName
  const dirX = typeof gIdx === 'number' ? (gIdx % 2 === 0 ? -1 : 1) : 0.7
  triggerHeroImpulse(dirX, isClosing ? 0.65 : 0.95)
}

function onGroupCapsuleClick(
  grp: { group: string; emotion: string; items: ModelStatePreset[] },
  gIdx: number,
) {
  if (grp.items[0]) {
    applyStatePreset(grp.items[0], gIdx)
  }
}

function togglePinGroup(grp: { group: string; items: ModelStatePreset[] }, gIdx: number) {
  const target =
    grp.items.find((p) => p.id === store.activeHoldPresetId) ??
    grp.items.find((p) => p.id === activePresetId.value) ??
    grp.items[0]
  if (target) {
    togglePinPreset(target, gIdx)
  }
}

function formatGroupPresetLabel(preset: ModelStatePreset, groupName: string): string {
  const raw = preset.label.trim()
  if (raw.startsWith(`${groupName}·`)) {
    const stripped = raw.slice(groupName.length + 1).trim()
    if (stripped) return stripped
  }
  return raw
}

function selectPresetGroupOption(groupName: string, emotion: string) {
  editingGroup.value = groupName
  editingEmotion.value = emotion
}

function triggerRandomInGroup(groupName: string, gIdx?: number) {
  const picked = pickRandomPresetInGroup(statePresets.value, groupName)
  if (picked) {
    applyStatePreset(picked, gIdx)
  }
}

const currentSelectedPreset = computed(() =>
  isCreatingNewPreset.value
    ? undefined
    : statePresets.value.find((p) => p.id === activePresetId.value),
)

const isCurrentPresetPinned = computed(
  () =>
    !!currentSelectedPreset.value &&
    store.activeHoldPresetId !== '' &&
    store.activeHoldPresetId === currentSelectedPreset.value.id,
)

const isOverwritingPreset = computed(() => {
  const clean = customPresetName.value.trim().toLowerCase()
  if (!clean) return false
  return statePresets.value.some((p) => p.label.toLowerCase() === clean)
})

const saveButtonLabel = computed(() => {
  if (isCreatingNewPreset.value) {
    return isOverwritingPreset.value ? '覆盖同名预设' : '创建并保存'
  }
  return isOverwritingPreset.value ? '保存修改' : '另存为新预设'
})

const finishModeShortLabel = computed(() => {
  if (editingFinishMode.value === 'hold') return '持续保持'
  if (editingFinishMode.value === 'loop') return '循环往复'
  return '播完恢复'
})

const currentPresetBadgeText = computed(() => {
  if (isCreatingNewPreset.value) return finishModeShortLabel.value
  if (isCurrentPresetPinned.value) return '常驻基准'
  return finishModeShortLabel.value
})

const totalControlsCount = computed(() => store.modelControls.length)
const faceSliders = computed(() => store.modelSliders.filter((s) => s.group === 'face'))
const poseSliders = computed(() => store.modelSliders.filter((s) => s.group === 'pose'))
const extraSliders = computed(() => store.modelSliders.filter((s) => s.group === 'extra'))

const CATEGORY_LABELS: Record<string, string> = {
  costume: '服装穿搭',
  hair: '发型发饰',
  hand: '手部动作',
  emotion: '脸部情绪',
  prop: '专属道具',
  other: '其他部件',
}

const CATEGORY_ORDER = ['costume', 'hair', 'hand', 'emotion', 'prop', 'other']

const controlGroups = computed(() => {
  const buckets = new Map<string, ResolvedModelControl[]>()
  for (const ctrl of store.modelControls) {
    const cat = CATEGORY_LABELS[ctrl.category] ? ctrl.category : 'other'
    let list = buckets.get(cat)
    if (!list) {
      list = []
      buckets.set(cat, list)
    }
    list.push(ctrl)
  }
  const activeSet = new Set(currentEditingStep.value.controls)
  return CATEGORY_ORDER.filter((cat) => (buckets.get(cat)?.length ?? 0) > 0).map((cat) => {
    const items = buckets.get(cat) ?? []
    const activeCount = items.filter((item) => activeSet.has(item.id)).length
    return {
      category: cat,
      label: CATEGORY_LABELS[cat] ?? '其他部件',
      items,
      activeCount,
    }
  })
})

/** 从当前正在编辑的分镜步骤读取滑块值（与舞台自动回退解耦，防止回退冲掉面板参数） */
function getStepSliderValue(slider: ResolvedModelSlider): number {
  const v = currentEditingStep.value.parameters[slider.id]
  return typeof v === 'number' && Number.isFinite(v) ? v : slider.defaultValue
}

function getSliderFillPercent(slider: ResolvedModelSlider): number {
  const val = getStepSliderValue(slider)
  const span = slider.max - slider.min
  if (span <= 0) return 0
  return Math.max(0, Math.min(100, ((val - slider.min) / span) * 100))
}

function isStepSliderModified(slider: ResolvedModelSlider): boolean {
  return Math.abs(getStepSliderValue(slider) - slider.defaultValue) > 1e-3
}

function isStepControlActive(controlId: string): boolean {
  return currentEditingStep.value.controls.includes(controlId)
}

const modifiedFaceSliderCount = computed(
  () => faceSliders.value.filter((s) => isStepSliderModified(s)).length,
)
const modifiedPoseSliderCount = computed(
  () => poseSliders.value.filter((s) => isStepSliderModified(s)).length,
)
const modifiedExtraSliderCount = computed(
  () => extraSliders.value.filter((s) => isStepSliderModified(s)).length,
)
const activeStepControlsCount = computed(() => currentEditingStep.value.controls.length)

function formatControlLabel(raw: string): string {
  return raw.replace(/\s*\([^)]*\)\s*$/, '').trim() || raw
}

function shouldSpanFullRow(ctrl: ResolvedModelControl, totalInGroup: number): boolean {
  return totalInGroup === 1 || formatControlLabel(ctrl.label).length > 6
}

function formatSliderValue(val: number, step: number): string {
  if (step >= 1) return String(Math.round(val))
  if (step >= 0.1) return val.toFixed(1)
  return val.toFixed(2)
}

function formatStepSec(ms: number): string {
  const sec = Math.max(0, ms) / 1000
  return Number(sec.toFixed(2)).toString()
}

function syncCurrentStepToLiveModel(transitionMs = 0): void {
  store.presetEditingLocked = true
  const step = currentEditingStep.value
  for (const c of store.modelControls) {
    c.active = false
  }
  if (step.controls.length > 0) {
    applyControlActionToList(
      store.modelControls,
      step.controls,
      'on',
      store.modelCapabilities,
    )
  }
  for (const s of store.modelSliders) {
    const v = step.parameters[s.id]
    s.value = typeof v === 'number' && Number.isFinite(v) ? v : s.defaultValue
  }
  store.syncSlidersToModel(transitionMs)
}

function loadPresetIntoEditor(preset: ModelStatePreset) {
  isCreatingNewPreset.value = false
  activePresetId.value = preset.id
  previousPresetId.value = preset.id
  customPresetName.value = preset.label
  editingEmotion.value = preset.emotion || 'neutral'
  editingGroup.value = resolvePresetGroup(preset)
  editingFinishMode.value = getPresetDefaultFinishMode(preset)
  editingMotion.value = preset.motion
  const norm = normalizePresetSteps(preset).map((s, i) => ({
    label: s.label || `步骤 ${i + 1}`,
    durationMs: s.durationMs,
    holdMs: s.holdMs,
    controls: [...s.controls],
    parameters: { ...s.parameters },
  }))
  editingSteps.value = norm
  editingStepIndex.value = norm.length - 1
}

// 面板未打开时才跟随后台状态切换；打开期间绝不在「播完恢复」结束时强行跳回日常待机
watch(
  () => store.activeRunningPresetId,
  (runningId) => {
    if (props.open || store.presetEditingLocked || !runningId) return
    if (activePresetId.value === runningId) return
    const matched = statePresets.value.find((p) => p.id === runningId)
    if (matched) {
      loadPresetIntoEditor(matched)
    }
  },
)

function openStudioForCurrentPreset() {
  switchTab('studio')
  expandedSections.sequence = true
}

function startNewPreset(targetGroup?: string, targetEmotion?: string) {
  if (!isCreatingNewPreset.value && activePresetId.value && activePresetId.value !== '__new__') {
    previousPresetId.value = activePresetId.value
  }
  const baseGroup =
    targetGroup?.trim() ||
    (currentSelectedPreset.value ? resolvePresetGroup(currentSelectedPreset.value) : '自定义')
  const baseEmotion =
    targetEmotion?.trim() || currentSelectedPreset.value?.emotion || 'neutral'
  isCreatingNewPreset.value = true
  activePresetId.value = '__new__'
  editingGroup.value = baseGroup
  editingEmotion.value = baseEmotion
  customPresetName.value = targetGroup ? `${targetGroup}·` : ''
  editingFinishMode.value = baseEmotion === 'neutral' ? 'hold' : 'revert'
  editingMotion.value = undefined
  const persistentIds = store.modelControls
    .filter((c) => isPersistentControlCategory(c.category) && c.active)
    .map((c) => c.id)
  const firstStep: PresetKeyframeStep = {
    label: '步骤 1',
    durationMs: 600,
    holdMs: 0,
    controls: persistentIds,
    parameters: {},
  }
  editingSteps.value = [firstStep]
  editingStepIndex.value = 0
  switchTab('studio')
  expandedSections.sequence = true
  store.presetEditingLocked = true
  store.previewPresetStep(firstStep, true)
  void nextTick(() => {
    presetNameInputRef.value?.focus()
  })
}

function cancelNewPreset() {
  isCreatingNewPreset.value = false
  const fallback =
    statePresets.value.find((p) => p.id === previousPresetId.value) ??
    (store.activeHoldPresetId
      ? statePresets.value.find((p) => p.id === store.activeHoldPresetId)
      : undefined) ??
    statePresets.value[0]
  if (fallback) {
    applyStatePreset(fallback, 0)
  }
  switchTab('states')
}

function selectEditingStep(idx: number) {
  const target = editingSteps.value[idx]
  if (!target) return
  store.presetEditingLocked = true
  editingStepIndex.value = idx
  store.previewPresetStep(target, true)
}

function addEditingStep() {
  store.presetEditingLocked = true
  const base = currentEditingStep.value
  const nextIdx = editingSteps.value.length + 1
  const newStep: PresetKeyframeStep = {
    label: `步骤 ${nextIdx}`,
    durationMs: 600,
    holdMs: 1000,
    controls: [...base.controls],
    parameters: { ...base.parameters },
  }
  editingSteps.value.push(newStep)
  editingStepIndex.value = editingSteps.value.length - 1
  store.previewPresetStep(newStep, true)
}

function removeCurrentEditingStep() {
  if (editingSteps.value.length <= 1) return
  store.presetEditingLocked = true
  const idx = editingStepIndex.value
  editingSteps.value.splice(idx, 1)
  const nextIdx = Math.max(0, Math.min(editingSteps.value.length - 1, idx))
  editingStepIndex.value = nextIdx
  store.previewPresetStep(editingSteps.value[nextIdx], true)
}

function onStepDurationChange(e: Event) {
  const sec = parseFloat((e.target as HTMLInputElement).value)
  if (!Number.isFinite(sec)) return
  currentEditingStep.value.durationMs = Math.max(40, Math.min(5000, Math.round(sec * 1000)))
}

function onStepHoldChange(e: Event) {
  const sec = parseFloat((e.target as HTMLInputElement).value)
  if (!Number.isFinite(sec)) return
  currentEditingStep.value.holdMs = Math.max(0, Math.min(10000, Math.round(sec * 1000)))
}

function previewEditingSequence() {
  store.presetEditingLocked = false
  const lastStep = editingSteps.value[editingSteps.value.length - 1]
  const tempPreset: ModelStatePreset = {
    id: activePresetId.value || 'preview',
    label: customPresetName.value.trim() || '预览状态',
    group: editingGroup.value.trim() || undefined,
    description: '',
    emotion: editingEmotion.value || 'neutral',
    controls: lastStep ? [...lastStep.controls] : [],
    parameters: lastStep ? { ...lastStep.parameters } : {},
    steps: editingSteps.value.map((s) => ({
      label: s.label,
      durationMs: s.durationMs,
      holdMs: s.holdMs,
      controls: [...s.controls],
      parameters: { ...s.parameters },
    })),
    finishMode: editingFinishMode.value,
    motion: editingMotion.value,
    custom: true,
  }
  store.triggerPreset(tempPreset, editingFinishMode.value)
}

function onSliderInput(slider: ResolvedModelSlider, e: Event) {
  const num = parseFloat((e.target as HTMLInputElement).value)
  if (!Number.isFinite(num)) return
  const step = currentEditingStep.value
  const rounded = Math.round(num * 100) / 100
  if (Math.abs(rounded - slider.defaultValue) > 1e-3) {
    step.parameters = { ...step.parameters, [slider.id]: rounded }
  } else {
    const nextParams = { ...step.parameters }
    delete nextParams[slider.id]
    step.parameters = nextParams
  }
  syncCurrentStepToLiveModel(0)
}

function resetSingleSlider(slider: ResolvedModelSlider) {
  const step = currentEditingStep.value
  const nextParams = { ...step.parameters }
  delete nextParams[slider.id]
  step.parameters = nextParams
  syncCurrentStepToLiveModel(600)
}

function resetSlidersByGroup(group: 'face' | 'pose' | 'extra') {
  const step = currentEditingStep.value
  const nextParams = { ...step.parameters }
  for (const s of store.modelSliders) {
    if (s.group === group) {
      delete nextParams[s.id]
    }
  }
  step.parameters = nextParams
  syncCurrentStepToLiveModel(600)
}

// ==================== motion-web Handfeel 物理弹簧与次级果冻引擎 ====================
let handfeelRafId = 0
let lastHandfeelTime = 0

// 1. 顶部导航栏胶囊滑块弹簧状态（§1 Underdamped Spring + §2 Velocity Coupling）
let navInitialized = false
let navX = 3
let navW = 64
let navTargetX = 3
let navTargetW = 64
let navVelX = 0
let navVelW = 0

// 2. 右下角鹅卵石次级果冻与流体共振状态（§4 Secondary Motion）
let pebbleJelly = 0
let pebbleJellyVel = 0

// 3. 左上角圆点磁吸与水滴果冻状态（Recipe #2 Magnetic Hover + §4）
let orbX = 0
let orbY = 0
let orbTargetX = 0
let orbTargetY = 0
let orbVelX = 0
let orbVelY = 0
let orbJelly = 0
let orbJellyVel = 0

// 4. 滚动速度耦合（驱动鹅卵石次级响应）
let lastScrollTop = 0
let scrollVel = 0

function wakeHandfeelLoop() {
  if (!props.open || handfeelRafId) return
  lastHandfeelTime = 0
  handfeelRafId = requestAnimationFrame(stepHandfeel)
}

function updateNavTarget(snapImmediate = false) {
  const navEl = navBarRef.value
  if (!navEl) return
  const activeBtn = navEl.querySelector('.bio-tab.active') as HTMLElement | null
  if (!activeBtn) return
  navTargetX = activeBtn.offsetLeft
  navTargetW = activeBtn.offsetWidth
  if (snapImmediate || !navInitialized) {
    navX = navTargetX
    navW = navTargetW
    navVelX = 0
    navVelW = 0
    navInitialized = true
    navEl.style.setProperty('--nav-x', `${navX.toFixed(2)}px`)
    navEl.style.setProperty('--nav-w', `${Math.max(28, navW).toFixed(2)}px`)
    navEl.style.setProperty('--nav-sx', '1')
    navEl.style.setProperty('--nav-sy', '1')
    navEl.style.setProperty('--nav-skew', '0deg')
  }
  wakeHandfeelLoop()
}

function triggerHeroImpulse(dirX = 0, strength = 1) {
  pebbleJellyVel += (dirX >= 0 ? 1.4 : -1.4) * strength
  wakeHandfeelLoop()
}

function switchTab(tab: 'states' | 'studio' | 'settings') {
  if (activeTab.value === tab) return
  activeTab.value = tab
  lastScrollTop = 0
  scrollVel = 0
  void nextTick(() => {
    updateNavTarget(false)
  })
}

function onOrbMouseMove(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement | null
  if (!el) return
  const r = el.getBoundingClientRect()
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  orbTargetX = (e.clientX - cx) * 0.38
  orbTargetY = (e.clientY - cy) * 0.38
  wakeHandfeelLoop()
}

function onOrbMouseLeave() {
  orbTargetX = 0
  orbTargetY = 0
  orbJellyVel += 0.8
  wakeHandfeelLoop()
}

function onPanelScroll(e: Event) {
  const el = e.currentTarget as HTMLElement | null
  if (!el) return
  const cur = el.scrollTop
  const delta = cur - lastScrollTop
  lastScrollTop = cur
  if (Math.abs(delta) < 120) {
    scrollVel = delta
    wakeHandfeelLoop()
  }
}

function stepHandfeel(now: number) {
  if (!props.open) {
    handfeelRafId = 0
    return
  }
  const rawDt = lastHandfeelTime ? (now - lastHandfeelTime) / 1000 : 1 / 60
  lastHandfeelTime = now
  const dt = Math.min(Math.max(rawDt, 0.001), 1 / 30)
  const frameScale = dt * 60

  const navEl = navBarRef.value
  const orbEl = orbBtnRef.value
  const pepEl = pebbleRef.value

  // 1. 顶部导航胶囊滑块：欠阻尼弹簧 + 速度耦合体积守恒拉伸（仅写入 navEl 叶子容器）
  if (navEl) {
    navVelX += (navTargetX - navX) * 84 * dt
    navVelX *= Math.pow(0.84, frameScale)
    navX += navVelX * dt

    navVelW += (navTargetW - navW) * 88 * dt
    navVelW *= Math.pow(0.85, frameScale)
    navW += navVelW * dt

    const speedStretch = Math.min(0.18, Math.abs(navVelX) * 0.00045)
    const navSx = 1 + speedStretch
    const navSy = 1 / navSx
    const navSkew = Math.max(-5, Math.min(5, -navVelX * 0.006))

    navEl.style.setProperty('--nav-x', `${navX.toFixed(2)}px`)
    navEl.style.setProperty('--nav-w', `${Math.max(28, navW).toFixed(2)}px`)
    navEl.style.setProperty('--nav-sx', navSx.toFixed(3))
    navEl.style.setProperty('--nav-sy', navSy.toFixed(3))
    navEl.style.setProperty('--nav-skew', `${navSkew.toFixed(2)}deg`)
  }

  // 2. 右下角鹅卵石：次级流体果冻（仅写入 pepEl 叶子节点）
  const primaryDrive = Math.max(-1.2, Math.min(1.2, scrollVel * 0.018))
  pebbleJellyVel += (primaryDrive - pebbleJelly) * 56 * dt
  pebbleJellyVel *= Math.pow(0.88, frameScale)
  pebbleJelly += pebbleJellyVel * dt
  scrollVel *= Math.pow(0.84, frameScale)

  if (pepEl) {
    const pepRot = pebbleJelly * 16
    const pepSx = Math.max(0.78, Math.min(1.26, 1 + pebbleJelly * 0.22))
    const pepSy = Math.max(0.78, Math.min(1.26, 1 / pepSx))
    pepEl.style.setProperty('--pep-rot', `${pepRot.toFixed(2)}deg`)
    pepEl.style.setProperty('--pep-sx', pepSx.toFixed(3))
    pepEl.style.setProperty('--pep-sy', pepSy.toFixed(3))
  }

  // 3. 左上角圆点：磁吸跟随 + 水滴果冻（仅写入 orbEl 叶子节点）
  orbVelX += (orbTargetX - orbX) * 92 * dt
  orbVelX *= Math.pow(0.82, frameScale)
  orbX += orbVelX * dt

  orbVelY += (orbTargetY - orbY) * 92 * dt
  orbVelY *= Math.pow(0.82, frameScale)
  orbY += orbVelY * dt

  orbJellyVel += (0 - orbJelly) * 68 * dt
  orbJellyVel *= Math.pow(0.86, frameScale)
  orbJelly += orbJellyVel * dt

  if (orbEl) {
    const orbStretch = Math.max(0.82, Math.min(1.22, 1 + orbJelly * 0.18))
    const orbSx = orbStretch
    const orbSy = 1 / orbStretch
    orbEl.style.setProperty('--orb-x', `${orbX.toFixed(2)}px`)
    orbEl.style.setProperty('--orb-y', `${orbY.toFixed(2)}px`)
    orbEl.style.setProperty('--orb-sx', orbSx.toFixed(3))
    orbEl.style.setProperty('--orb-sy', orbSy.toFixed(3))
  }

  const navRest =
    Math.abs(navTargetX - navX) < 0.08 &&
    Math.abs(navTargetW - navW) < 0.08 &&
    Math.abs(navVelX) < 0.15 &&
    Math.abs(navVelW) < 0.15
  const pepRest =
    Math.abs(pebbleJelly) < 0.004 &&
    Math.abs(pebbleJellyVel) < 0.01 &&
    Math.abs(scrollVel) < 0.1
  const orbRest =
    Math.abs(orbTargetX - orbX) < 0.05 &&
    Math.abs(orbTargetY - orbY) < 0.05 &&
    Math.abs(orbVelX) < 0.1 &&
    Math.abs(orbVelY) < 0.1 &&
    Math.abs(orbJelly) < 0.004 &&
    Math.abs(orbJellyVel) < 0.01

  if (navRest && pepRest && orbRest) {
    handfeelRafId = 0
    return
  }

  handfeelRafId = requestAnimationFrame(stepHandfeel)
}

function startHandfeelLoop() {
  if (handfeelRafId) cancelAnimationFrame(handfeelRafId)
  handfeelRafId = 0
  lastHandfeelTime = 0
  navInitialized = false
  void nextTick(() => {
    updateNavTarget(true)
  })
}

function stopHandfeelLoop() {
  if (handfeelRafId) {
    cancelAnimationFrame(handfeelRafId)
    handfeelRafId = 0
  }
}

function applyStatePreset(preset: ModelStatePreset, idx?: number) {
  store.presetEditingLocked = false
  const dirX = typeof idx === 'number' ? (idx % 2 === 0 ? -1 : 1) : 0
  triggerHeroImpulse(dirX, 1)
  loadPresetIntoEditor(preset)
  if (displayMode.value === 'live2d' && store.live2dModel) {
    store.triggerPreset(preset)
  } else {
    store.currentEmotion = preset.emotion
    store.emotionPulse++
  }
}

function togglePinPreset(preset: ModelStatePreset, idx?: number) {
  store.presetEditingLocked = false
  const dirX = typeof idx === 'number' ? (idx % 2 === 0 ? -1 : 1) : 0.6
  triggerHeroImpulse(dirX, 1.15)
  if (store.activeHoldPresetId === preset.id) {
    // 取消常驻：清空常驻 ID，当前选中的预设卡片不跳走，舞台平滑回到日常待机
    store.activeHoldPresetId = ''
    const neutralPreset = statePresets.value.find((p) => p.id === 'neutral')
    if (neutralPreset && displayMode.value === 'live2d' && store.live2dModel) {
      store.triggerPreset(neutralPreset, 'hold')
    }
    return
  }
  store.activeHoldPresetId = preset.id
  loadPresetIntoEditor(preset)
  if (displayMode.value === 'live2d' && store.live2dModel) {
    store.triggerPreset(preset, 'hold')
  }
}

function saveCurrentCombo() {
  const name = customPresetName.value.trim()
  if (!name) return
  store.presetEditingLocked = false
  const saved = store.saveCustomPreset(name, undefined, undefined, editingEmotion.value, {
    group: editingGroup.value.trim() || undefined,
    steps: editingSteps.value,
    finishMode: editingFinishMode.value,
    motion: editingMotion.value,
  })
  if (saved) {
    loadPresetIntoEditor(saved)
    if (displayMode.value === 'live2d' && store.live2dModel) {
      store.triggerPreset(saved)
    }
  }
}

function removeCustomPreset(id: string) {
  store.deleteCustomPreset(id)
  if (activePresetId.value === id) {
    const fallback = statePresets.value[0]
    if (fallback) {
      loadPresetIntoEditor(fallback)
    } else {
      activePresetId.value = ''
      customPresetName.value = ''
    }
  }
}

function onRestoreDefaultPresets() {
  store.activeHoldPresetId = ''
  const restored = store.restoreDefaultPresets()
  if (restored.length > 0) {
    applyStatePreset(restored[0], 0)
  }
}

function toggleSingleControl(controlId: string) {
  const step = currentEditingStep.value
  const tempControls = store.modelControls.map((c) => ({
    ...c,
    active: step.controls.includes(c.id),
  }))
  applyControlActionToList(tempControls, controlId, 'toggle', store.modelCapabilities)
  step.controls = tempControls.filter((c) => c.active).map((c) => c.id)
  syncCurrentStepToLiveModel(600)
}

function resetTransientControls() {
  const step = currentEditingStep.value
  step.controls = step.controls.filter((id) => {
    const ctrl = store.modelControls.find((c) => c.id === id)
    return ctrl ? isPersistentControlCategory(ctrl.category) : false
  })
  syncCurrentStepToLiveModel(600)
}

function resetAllControls() {
  store.presetEditingLocked = false
  store.activeHoldPresetId = ''
  isCreatingNewPreset.value = false
  triggerHeroImpulse(0, 0.9)
  const neutralPreset = statePresets.value.find((p) => p.id === 'neutral')
  if (neutralPreset) {
    loadPresetIntoEditor(neutralPreset)
  } else {
    activePresetId.value = 'neutral'
    customPresetName.value = ''
    editingSteps.value = [
      { label: '步骤 1', durationMs: 600, holdMs: 0, controls: [], parameters: {} },
    ]
    editingStepIndex.value = 0
    editingFinishMode.value = 'hold'
  }
  store.applyControlAction('', 'reset')
  store.currentEmotion = 'neutral'
  store.emotionPulse++
}

const orbColorInputRef = ref<HTMLInputElement | null>(null)
const quickModelBarOpen = ref(false)

const orbTooltip = computed(() => {
  switch (store.orbAction) {
    case 'model_picker':
      return '快捷圆点：点击展开/收起模型选择栏（可在面板设置中更改）'
    case 'toggle_display_mode':
      return `快捷圆点：点击切换至${displayMode.value === 'live2d' ? '静态立绘' : 'Live2D 模型'}（可在面板设置中更改）`
    case 'color_picker':
      return '快捷圆点：点击打开自定义调色盘（可在面板设置中更改）'
    case 'toggle_theme':
      return `快捷圆点：点击切换至${store.themeMode === 'dark' ? '日间模式' : '夜间模式'}（可在面板设置中更改）`
    default:
      return '快捷圆点'
  }
})

function toggleQuickDisplayMode() {
  const nextKind: ModelKind = displayMode.value === 'live2d' ? 'image-set' : 'live2d'
  void setDisplayMode(nextKind)
}

function onOrbClick() {
  orbJellyVel += 2.8
  pebbleJellyVel += 1.6
  wakeHandfeelLoop()
  switch (store.orbAction) {
    case 'model_picker':
      quickModelBarOpen.value = !quickModelBarOpen.value
      break
    case 'toggle_display_mode':
      toggleQuickDisplayMode()
      break
    case 'color_picker':
      orbColorInputRef.value?.click()
      break
    case 'toggle_theme':
      store.themeMode = store.themeMode === 'dark' ? 'light' : 'dark'
      break
  }
}

function onAccentColorInput(e: Event) {
  const val = (e.target as HTMLInputElement).value
  if (val) store.accentColor = val
}

function toggleClickThroughLock() {
  const next = !store.clickThroughLocked
  store.clickThroughLocked = next
  window.electronAPI?.setClickThroughLocked?.(next)
}

function get(k: string, fallback = '') {
  try {
    return localStorage.getItem(k) || fallback
  } catch {
    return fallback
  }
}
function set(k: string, v: string) {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* ignore */
  }
}

const wsUrl = ref(get('deskpet/ws-url', 'ws://127.0.0.1:8523/ws'))
const wsToken = ref(get('deskpet/ws-token'))
const sttUrl = ref(get('deskpet/stt-url', 'http://127.0.0.1:18530/stt'))
const autoSsInterval = ref(get('deskpet/auto-screenshot-interval', '60'))
const vadThreshold = ref(get('deskpet/vad-threshold', '0.02'))
const vadSilence = ref(get('deskpet/vad-silence', '1.5'))
const pttKey = ref('f9')
const pttMode = ref(get('deskpet/ptt-mode', 'ptt'))

const models = ref<Awaited<ReturnType<typeof listAvailableModels>>>([])
const selectedModel = ref('')
const switching = ref(false)
const settingsModelListOpen = ref(false)

const displayMode = computed<ModelKind>(() => {
  const current = selectedModel.value || store.modelUrl
  return current ? kindOfModelUrl(current) : 'live2d'
})

const filteredModels = computed(() => models.value.filter((m) => m.kind === displayMode.value))

const currentModelDisplayName = computed(() => {
  const found = filteredModels.value.find((m) => m.url === selectedModel.value)
  if (found) return found.name
  if (filteredModels.value.length > 0) return filteredModels.value[0].name
  return displayMode.value === 'live2d' ? '未发现 Live2D 模型' : '未发现静态立绘包'
})

async function setDisplayMode(kind: ModelKind) {
  if (kind === displayMode.value) return
  const first = models.value.find((m) => m.kind === kind)
  if (!first) return
  switching.value = true
  try {
    await store.requestModelSwitch(first.url)
  } finally {
    switching.value = false
    selectedModel.value = store.modelUrl || first.url
    void nextTick(() => updateNavTarget(false))
  }
}

async function loadModels(forceRescan = false) {
  models.value = await listAvailableModels(forceRescan)
  selectedModel.value = store.modelUrl || getStoredModelPath() || models.value[0]?.url || ''
}

onMounted(() => {
  void loadModels()
  const initialPreset = statePresets.value.find((p) => p.id === activePresetId.value) ?? statePresets.value[0]
  if (initialPreset) {
    loadPresetIntoEditor(initialPreset)
  }
  if (props.open) {
    startHandfeelLoop()
  }
  void (async () => {
    try {
      const cfg = await window.electronAPI?.getServicesConfig()
      if (cfg?.pttKey) pttKey.value = cfg.pttKey
    } catch {
      /* ignore */
    }
  })()
})

onUnmounted(() => {
  stopHandfeelLoop()
})

watch(
  () => props.open,
  (open) => {
    if (open) {
      void loadModels()
      startHandfeelLoop()
    } else {
      store.presetEditingLocked = false
      stopHandfeelLoop()
    }
  },
)
watch(
  () => store.modelUrl,
  (url) => {
    if (url) {
      selectedModel.value = url
      activePresetId.value = 'neutral'
      const neutral = statePresets.value.find((p) => p.id === 'neutral') ?? statePresets.value[0]
      if (neutral) loadPresetIntoEditor(neutral)
    }
  },
)

async function rescan() {
  await loadModels(true)
}

function openModelsFolder() {
  void window.electronAPI?.openModelsFolder()
}

async function selectModelUrl(url: string) {
  if (!url || url === store.modelUrl) {
    settingsModelListOpen.value = false
    return
  }
  switching.value = true
  try {
    await store.requestModelSwitch(url)
  } finally {
    switching.value = false
    selectedModel.value = store.modelUrl || url
    settingsModelListOpen.value = false
  }
}

function reload() {
  window.electronAPI?.reloadWindow()
}

function setWsUrl(e: Event) {
  const v = (e.target as HTMLInputElement).value
  wsUrl.value = v
  set('deskpet/ws-url', v)
  window.dispatchEvent(new CustomEvent('deskpet:ws-config-changed'))
}
function setWsToken(e: Event) {
  const v = (e.target as HTMLInputElement).value
  wsToken.value = v
  set('deskpet/ws-token', v)
  window.dispatchEvent(new CustomEvent('deskpet:ws-config-changed'))
}
function setSttUrl(e: Event) {
  const v = (e.target as HTMLInputElement).value
  sttUrl.value = v
  set('deskpet/stt-url', v)
}
function setAutoSsInterval(e: Event) {
  const v = (e.target as HTMLInputElement).value
  autoSsInterval.value = v
  set('deskpet/auto-screenshot-interval', v)
  window.electronAPI?.setAutoScreenshotInterval(parseInt(v) || 60)
}
function setVadThreshold(e: Event) {
  const v = (e.target as HTMLInputElement).value
  vadThreshold.value = v
  set('deskpet/vad-threshold', v)
}
function setVadSilence(e: Event) {
  const v = (e.target as HTMLInputElement).value
  vadSilence.value = v
  set('deskpet/vad-silence', v)
}
function setPttMode(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  pttMode.value = v
  set('deskpet/ptt-mode', v)
}
function setPttKey(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  pttKey.value = v
  void window.electronAPI?.setServicesConfig({ pttKey: v })
}
</script>

<style scoped>
/* ==================== Organic Biophilic 伴随浮窗容器 ==================== */
.companion-window {
  position: absolute;
  width: 328px;
  max-width: calc(100vw - 24px);
  height: min(520px, calc(100vh - 44px));
  background: var(--dp-panel-bg);
  border-radius: 28px;
  box-shadow: var(--dp-shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 66;
  color: var(--dp-text-main);
  -webkit-app-region: no-drag;
  transition:
    background-color 0.28s ease,
    color 0.28s ease,
    box-shadow 0.28s ease;
}

.companion-window.pop-left {
  left: 10px;
  --slide-x: 18px;
}

.companion-window.pop-right {
  right: 10px;
  --slide-x: -18px;
}

.companion-window.align-bottom {
  bottom: 32px;
}

.companion-window.align-top {
  top: 18px;
}

.companion-slide-enter-active {
  transition:
    opacity 200ms var(--ease-out-expo),
    transform 240ms var(--ease-out-expo);
}

.companion-slide-leave-active {
  transition:
    opacity 150ms ease,
    transform 170ms ease;
}

.companion-slide-enter-from,
.companion-slide-leave-to {
  opacity: 0;
  transform: translateX(var(--slide-x, 18px));
}

.bio-popover-enter-active {
  transition:
    opacity 180ms var(--ease-out-expo),
    transform 220ms var(--ease-out-expo);
}
.bio-popover-leave-active {
  transition:
    opacity 130ms ease,
    transform 140ms ease;
}
.bio-popover-enter-from,
.bio-popover-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.bio-tab-switch-enter-active {
  transition:
    opacity 170ms var(--ease-out-expo),
    transform 210ms var(--ease-out-expo);
}
.bio-tab-switch-leave-active {
  transition:
    opacity 100ms ease,
    transform 100ms ease;
}
.bio-tab-switch-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.bio-tab-switch-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}

/* 主卡标题与右上角徽章柔和过渡 */
.hero-title-flip-enter-active {
  transition:
    opacity 160ms var(--ease-out-expo),
    transform 200ms var(--ease-out-expo);
}
.hero-title-flip-leave-active {
  transition:
    opacity 85ms ease,
    transform 85ms ease;
}
.hero-title-flip-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.hero-title-flip-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}

.hero-badge-pop-enter-active {
  transition:
    opacity 150ms ease,
    transform 200ms var(--ease-out-expo);
}
.hero-badge-pop-leave-active {
  transition:
    opacity 80ms ease,
    transform 80ms ease;
}
.hero-badge-pop-enter-from {
  opacity: 0;
  transform: translateY(2px);
}
.hero-badge-pop-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}

.scroll-reactive {
  transform: none;
}

.pressable {
  transition:
    transform 520ms var(--spring-gentle) 55ms,
    background-color 180ms ease,
    color 180ms ease,
    box-shadow 200ms ease;
}
.pressable:active:not(:disabled) {
  transform: translateY(1px) scale(0.955);
  transition:
    transform 105ms cubic-bezier(0.22, 1, 0.36, 1) 0ms,
    background-color 120ms ease,
    color 120ms ease,
    box-shadow 120ms ease;
}

/* ==================== 顶部有机导航栏 ==================== */
.bio-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 16px 8px;
  flex-shrink: 0;
}

.bio-orb-btn {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: none;
  padding: 0;
  background: var(--dp-orb-grad);
  box-shadow: 0 4px 12px var(--dp-accent-glow);
  cursor: pointer;
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
  transform: translate3d(var(--orb-x, 0px), var(--orb-y, 0px), 0)
    scale(var(--orb-sx, 1), var(--orb-sy, 1));
  transition: box-shadow 200ms ease;
  will-change: transform;
}
.bio-orb-btn:hover {
  box-shadow: 0 6px 16px var(--dp-accent-glow);
}
.bio-orb-btn.active {
  box-shadow: 0 0 0 2px var(--dp-text-main), 0 4px 12px var(--dp-accent-glow);
}

.bio-orb-color-input {
  position: absolute;
  inset: 0;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
  border: none;
}

.quick-drawer-collapse {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  margin: 0 14px 0;
  pointer-events: none;
  flex-shrink: 0;
  transition:
    grid-template-rows 360ms var(--spring-gentle),
    margin-bottom 360ms var(--spring-gentle),
    opacity 220ms var(--ease-out-expo);
}
.quick-drawer-collapse.open {
  grid-template-rows: 1fr;
  opacity: 1;
  margin: 0 14px 6px;
  pointer-events: auto;
}

.quick-drawer-inner {
  overflow: hidden;
  min-height: 0;
}

.bio-quick-model-drawer {
  padding: 10px 11px;
  border-radius: 18px;
  background: var(--dp-card-bg);
  border: 1px solid var(--dp-accent-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}

.quick-drawer-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.quick-mode-strip {
  flex: 1;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.bio-model-picker {
  display: flex;
  flex-direction: column;
}

.bio-model-trigger {
  width: 100%;
  height: 36px;
  padding: 0 12px;
  border-radius: 12px;
  border: none;
  background: var(--dp-pill-inner);
  color: var(--dp-text-main);
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.bio-model-trigger:hover:not(:disabled) {
  background: var(--dp-card-hover);
}
.bio-model-picker.open .bio-fold-arrow {
  transform: rotate(90deg);
}

.bio-model-trigger-name {
  flex: 1;
  min-width: 0;
  text-align: left;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ctrl-dot.active-dot {
  background: var(--dp-accent);
  opacity: 1;
}

.bio-model-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 156px;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  padding: 2px;
}
.bio-model-list::-webkit-scrollbar {
  width: 4px;
}
.bio-model-list::-webkit-scrollbar-thumb {
  background: var(--dp-scrollbar);
  border-radius: 999px;
}

.settings-model-list {
  margin-top: 6px;
  background: var(--dp-input-bg);
  border-radius: 14px;
  padding: 6px;
}

.bio-model-item {
  height: 32px;
  padding: 0 11px;
  border-radius: 11px;
  border: none;
  background: var(--dp-pill-inner);
  color: var(--dp-text-main);
  display: flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  min-width: 0;
  flex-shrink: 0;
}
.bio-model-item:hover:not(:disabled) {
  background: var(--dp-card-hover);
}
.bio-model-item.active {
  background: var(--dp-accent);
  color: var(--dp-accent-text);
  box-shadow: 0 3px 10px -2px var(--dp-accent-glow);
}
.bio-model-item.active .ctrl-dot {
  background: currentColor;
  opacity: 1;
}

.bio-model-item-name {
  flex: 1;
  min-width: 0;
  text-align: left;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bio-model-item.active .bio-model-item-name {
  font-weight: 700;
}

.bio-model-item-tag {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.22);
  color: currentColor;
  white-space: nowrap;
  flex-shrink: 0;
}

.bio-model-empty {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--dp-text-dim);
  text-align: center;
  padding: 8px 0;
}

.ctrl-state-tag {
  font-size: 10px;
  font-weight: 700;
  opacity: 0.72;
  white-space: nowrap;
  flex-shrink: 0;
}
.ctrl-capsule.active .ctrl-state-tag {
  opacity: 0.92;
}

.bio-nav {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 14px;
  background: var(--dp-card-bg);
  flex-shrink: 0;
}

/* 物理弹簧 + 速度拉伸滑动底座 */
.bio-nav-slider {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 0;
  width: var(--nav-w, 64px);
  border-radius: 11px;
  background: var(--dp-panel-bg);
  box-shadow: 0 2px 9px rgba(0, 0, 0, 0.1);
  transform: translate3d(var(--nav-x, 3px), 0, 0)
    scale(var(--nav-sx, 1), var(--nav-sy, 1))
    skewX(var(--nav-skew, 0deg));
  transform-origin: center center;
  pointer-events: none;
  z-index: 0;
  will-change: transform, width;
}

.bio-tab {
  position: relative;
  z-index: 1;
  border: none;
  background: transparent;
  color: var(--dp-text-sub);
  font-size: 11.5px;
  font-weight: 700;
  padding: 5px 11px;
  border-radius: 11px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition:
    color 180ms ease,
    transform 480ms var(--spring-gentle) 45ms;
}
.bio-tab:hover:not(.active) {
  color: var(--dp-text-main);
}
.bio-tab:active {
  transform: translateY(1px) scale(0.95);
  transition: transform 95ms cubic-bezier(0.22, 1, 0.36, 1) 0ms;
}
.bio-tab.active {
  color: var(--dp-text-main);
}

.bio-header-actions {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

.bio-icon-btn {
  width: 28px;
  height: 28px;
  border-radius: 10px;
  border: none;
  background: var(--dp-card-bg);
  color: var(--dp-text-sub);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition:
    background-color 160ms ease,
    color 160ms ease,
    transform 460ms var(--spring-gentle) 45ms;
}
.bio-icon-btn:hover {
  background: var(--dp-card-hover);
  color: var(--dp-text-main);
}
.bio-icon-btn:active {
  transform: scale(0.92);
  transition: transform 95ms cubic-bezier(0.22, 1, 0.36, 1) 0ms;
}
.bio-icon-btn svg {
  width: 14px;
  height: 14px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* ==================== 滚动内容区 ==================== */
.bio-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  padding: 6px 10px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.bio-scroll::-webkit-scrollbar {
  width: 4px;
}
.bio-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.bio-scroll::-webkit-scrollbar-thumb {
  background: var(--dp-scrollbar);
  border-radius: 999px;
}

/* ==================== 暖燕麦色主卡与容器 (Oat Well) ==================== */
.oat-hero-well,
.oat-well {
  background: var(--dp-card-bg);
  border-radius: 20px;
  padding: 13px 14px;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}

.oat-hero-pebble {
  position: absolute;
  right: -16px;
  bottom: -20px;
  width: 68px;
  height: 68px;
  border-radius: 44% 56% 50% 50%;
  background: var(--dp-accent-soft);
  pointer-events: none;
  transform: translate3d(var(--pep-x, 0px), var(--pep-y, 0px), 0)
    rotate(var(--pep-rot, 0deg))
    scale(var(--pep-sx, 1), var(--pep-sy, 1));
  will-change: transform;
}

.oat-hero-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: relative;
  z-index: 1;
}

.oat-eyebrow-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  position: relative;
  z-index: 1;
}

.oat-eyebrow {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--dp-text-dim);
  white-space: nowrap;
}

.oat-mode-pill {
  border: none;
  font-size: 10.5px;
  font-weight: 700;
  padding: 2px 9px;
  border-radius: 8px;
  background: var(--dp-pill-inner);
  color: var(--dp-accent-vivid);
  white-space: nowrap;
  flex-shrink: 0;
}
.oat-mode-pill.pinned {
  background: var(--dp-accent);
  color: var(--dp-accent-text);
}

.oat-hero-title {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--dp-text-main);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  position: relative;
  z-index: 1;
}

.oat-hero-desc {
  font-size: 11px;
  font-weight: 500;
  color: var(--dp-text-sub);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  position: relative;
  z-index: 1;
}

.oat-hero-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  position: relative;
  z-index: 1;
}

.bio-btn-pill {
  height: 30px;
  padding: 0 12px;
  border-radius: 11px;
  border: none;
  background: var(--dp-pill-inner);
  color: var(--dp-text-main);
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  white-space: nowrap;
  flex-shrink: 0;
}
.bio-btn-pill:hover:not(:disabled) {
  background: var(--dp-card-hover);
}
.bio-btn-pill:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.bio-btn-pill.accent {
  background: var(--dp-accent);
  color: var(--dp-accent-text);
  box-shadow: 0 4px 12px -2px var(--dp-accent-glow);
}
.bio-btn-pill.accent:hover:not(:disabled) {
  filter: brightness(1.06);
}
.bio-btn-pill.clay {
  background: var(--dp-clay);
  color: #2b2118;
}
.bio-btn-pill.pinned {
  background: var(--dp-accent-soft);
  color: var(--dp-accent-vivid);
}
.bio-btn-pill.danger {
  color: #c94a4a;
}
.bio-btn-pill.danger:hover:not(:disabled) {
  background: rgba(201, 74, 74, 0.14);
}

/* ==================== 状态预设双列等宽圆角矩形网格 ==================== */
.bio-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.bio-sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 2px;
}

.bio-sec-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--dp-text-dim);
  white-space: nowrap;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bio-sec-links {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.bio-sec-dot {
  color: var(--dp-text-dim);
  font-size: 10px;
}

.bio-sec-link {
  border: none;
  background: transparent;
  color: var(--dp-text-sub);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  padding: 2px 5px;
  border-radius: 7px;
  white-space: nowrap;
  flex-shrink: 0;
}
.bio-sec-link:hover {
  color: var(--dp-text-main);
  background: var(--dp-card-bg);
}

.preset-rows-stack {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.preset-row-block {
  display: flex;
  flex-direction: column;
}

.group-drawer-collapse {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  margin-top: 0;
  pointer-events: none;
  transition:
    grid-template-rows 360ms var(--spring-gentle),
    margin-top 340ms var(--spring-gentle),
    opacity 220ms var(--ease-out-expo);
}
.group-drawer-collapse.open {
  grid-template-rows: 1fr;
  opacity: 1;
  margin-top: 7px;
  pointer-events: auto;
}

.group-drawer-inner {
  overflow: hidden;
  min-height: 0;
}

.preset-group-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 11px 11px;
  border-radius: 16px;
  background: var(--dp-card-bg);
  border: 1px solid var(--dp-accent-border);
}

.preset-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px;
  cursor: pointer;
  user-select: none;
}

.preset-group-title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.preset-group-name {
  font-size: 12px;
  font-weight: 800;
  color: var(--dp-text-main);
  white-space: nowrap;
}

.preset-group-count {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--dp-pill-inner);
  color: var(--dp-text-sub);
}

.preset-group-actions {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

.preset-group-btn {
  height: 22px;
  padding: 0 8px;
  border-radius: 8px;
  border: none;
  background: var(--dp-pill-inner);
  color: var(--dp-text-sub);
  font-size: 10.5px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
.preset-group-btn:hover {
  color: var(--dp-text-main);
  background: var(--dp-card-hover);
}
.preset-group-btn.rand {
  background: var(--dp-accent-soft);
  color: var(--dp-accent-vivid);
}
.preset-group-btn.rand:hover {
  background: var(--dp-accent-fill);
}

.preset-capsule-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}

.preset-capsule {
  height: 38px;
  padding: 0 10px 0 13px;
  border-radius: 13px;
  border: none;
  background: var(--dp-card-bg);
  color: var(--dp-text-main);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
  cursor: pointer;
  min-width: 0;
  user-select: none;
}
.preset-capsule.group-capsule {
  padding: 0 9px 0 7px;
}
.preset-capsule.group-capsule.drawer-open:not(.active) {
  box-shadow: inset 0 0 0 1.5px var(--dp-accent-border);
  background: var(--dp-card-hover);
}
.preset-capsule.inner-variant {
  height: 35px;
  padding: 0 9px 0 12px;
  border-radius: 11px;
  background: var(--dp-pill-inner);
}
.preset-capsule:hover {
  background: var(--dp-card-hover);
}
.preset-capsule.active {
  background: var(--dp-accent);
  color: var(--dp-accent-text);
  box-shadow: 0 5px 14px -3px var(--dp-accent-glow);
}

.capsule-expand-btn {
  width: 20px;
  height: 20px;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: var(--dp-text-dim);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background-color 150ms ease,
    color 150ms ease,
    transform 240ms var(--spring-gentle);
}
.capsule-expand-btn:hover {
  background: var(--dp-pill-inner);
  color: var(--dp-text-main);
}
.capsule-expand-btn:active {
  transform: scale(0.84);
}
.capsule-expand-btn.open {
  color: var(--dp-accent-vivid);
  background: var(--dp-accent-soft);
}
.preset-capsule.active .capsule-expand-btn {
  color: rgba(255, 255, 255, 0.85);
}
.preset-capsule.active .capsule-expand-btn.open,
.preset-capsule.active .capsule-expand-btn:hover {
  background: rgba(255, 255, 255, 0.22);
  color: #ffffff;
}
.capsule-expand-btn svg {
  width: 12px;
  height: 12px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2.3;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 360ms var(--spring-bouncy);
}
.capsule-expand-btn.open svg {
  transform: rotate(90deg);
}

.preset-capsule-name {
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
  text-align: left;
}
.preset-capsule.active .preset-capsule-name {
  font-weight: 700;
}

.preset-capsule-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.preset-step-tag {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 7px;
  background: var(--dp-accent-soft);
  color: var(--dp-accent-vivid);
  white-space: nowrap;
}
.preset-capsule.active .preset-step-tag {
  background: rgba(255, 255, 255, 0.22);
  color: #ffffff;
}

.capsule-pin-btn {
  width: 22px;
  height: 22px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--dp-text-dim);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
  opacity: 0.45;
  flex-shrink: 0;
  transition:
    opacity 150ms ease,
    background-color 150ms ease,
    color 150ms ease,
    transform 460ms var(--spring-gentle) 45ms;
}
.preset-capsule:hover .capsule-pin-btn {
  opacity: 0.85;
}
.capsule-pin-btn:hover {
  opacity: 1;
}
.capsule-pin-btn:active {
  transform: scale(0.88);
  transition: transform 95ms cubic-bezier(0.22, 1, 0.36, 1) 0ms;
}
.capsule-pin-btn.active {
  opacity: 1;
  background: var(--dp-accent-soft);
  color: var(--dp-accent-vivid);
}
.preset-capsule.active .capsule-pin-btn {
  color: rgba(255, 255, 255, 0.85);
}
.preset-capsule.active .capsule-pin-btn.active {
  background: rgba(255, 255, 255, 0.24);
  color: #ffffff;
}
.capsule-pin-btn svg {
  width: 12px;
  height: 12px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.preset-capsule.add-new {
  background: var(--dp-accent-soft);
  color: var(--dp-accent-vivid);
  justify-content: center;
  padding: 0 12px;
}
.preset-capsule.add-new .preset-capsule-name {
  text-align: center;
  font-weight: 800;
  color: var(--dp-accent-vivid);
}
.preset-capsule.add-new:hover {
  background: var(--dp-accent-fill);
}

/* ==================== 预设工坊：可折叠燕麦分组卡片 + 弹簧手风琴过渡 ==================== */
.bio-fold-card {
  background: var(--dp-card-bg);
  border-radius: 20px;
  overflow: hidden;
  flex-shrink: 0;
}

.bio-fold-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 11px 14px;
  cursor: pointer;
  user-select: none;
  transition: background-color 150ms ease;
}
.bio-fold-head:hover {
  background: var(--dp-card-hover);
}
.bio-fold-head:active {
  transform: scale(0.99, 1.01);
}

.bio-fold-title-wrap {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.bio-fold-arrow {
  width: 14px;
  height: 14px;
  stroke: var(--dp-text-sub);
  fill: none;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
  flex-shrink: 0;
  transition: transform 360ms var(--spring-bouncy);
}
.bio-fold-card.open .bio-fold-arrow {
  transform: rotate(90deg);
}

.bio-fold-title {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--dp-text-main);
  white-space: nowrap;
}

.bio-fold-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.bio-fold-badge {
  font-size: 10.5px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 8px;
  background: var(--dp-pill-inner);
  color: var(--dp-text-sub);
  white-space: nowrap;
  flex-shrink: 0;
  transition: background-color 180ms ease, color 180ms ease;
}
.bio-fold-badge.accent {
  background: var(--dp-accent-soft);
  color: var(--dp-accent-vivid);
}

.bio-fold-collapse {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows 360ms var(--spring-gentle),
    opacity 220ms var(--ease-out-expo);
}
.bio-fold-collapse.open {
  grid-template-rows: 1fr;
  opacity: 1;
}

.bio-fold-inner {
  overflow: hidden;
  min-height: 0;
}

.bio-fold-body {
  padding: 4px 12px 13px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

/* ==================== 预设分镜与保存内部排版 ==================== */
.pebble-seq-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.seq-pebble {
  border: none;
  padding: 5px 11px;
  border-radius: 10px;
  background: var(--dp-pill-inner);
  color: var(--dp-text-sub);
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  flex-shrink: 0;
}
.seq-pebble:hover {
  color: var(--dp-text-main);
}
.seq-pebble.active {
  background: var(--dp-accent);
  color: var(--dp-accent-text);
  box-shadow: 0 3px 10px -2px var(--dp-accent-glow);
}
.seq-pebble.add-step {
  background: var(--dp-accent-soft);
  color: var(--dp-accent-vivid);
  font-weight: 800;
}

.studio-timing-row {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: nowrap;
}

.bio-pill-input {
  height: 30px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: var(--dp-input-bg);
  color: var(--dp-text-main);
  font-size: 11.5px;
  font-weight: 600;
  outline: none;
  min-width: 0;
  transition:
    border-color 180ms ease,
    background-color 180ms ease;
}
.bio-pill-input:focus {
  border-color: var(--dp-accent-border);
}
.bio-pill-input.full {
  width: 100%;
  border-radius: 11px;
}

.step-label-input {
  flex: 1;
  min-width: 60px;
}

.bio-time-chip {
  height: 30px;
  padding: 0 8px;
  border-radius: 10px;
  background: var(--dp-input-bg);
  color: var(--dp-text-sub);
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
  flex-shrink: 0;
}
.bio-time-chip input {
  width: 34px;
  border: none;
  background: transparent;
  color: var(--dp-text-main);
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11.5px;
  font-weight: 700;
  text-align: center;
  outline: none;
}

.bio-del-step-btn {
  height: 30px;
  padding: 0 9px;
  border-radius: 10px;
  border: none;
  background: rgba(201, 74, 74, 0.14);
  color: #c94a4a;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}

.studio-mode-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  padding: 3px;
  border-radius: 12px;
  background: var(--dp-input-bg);
}
.oat-well .studio-mode-strip {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.studio-mode-btn {
  height: 28px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--dp-text-sub);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  padding: 0 6px;
}
.studio-mode-btn.active {
  background: var(--dp-accent);
  color: var(--dp-accent-text);
}

.studio-group-block {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.studio-group-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.studio-group-chip {
  height: 24px;
  padding: 0 9px;
  border-radius: 8px;
  border: none;
  background: var(--dp-pill-inner);
  color: var(--dp-text-sub);
  font-size: 10.5px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
.studio-group-chip:hover {
  color: var(--dp-text-main);
}
.studio-group-chip.active {
  background: var(--dp-accent-soft);
  color: var(--dp-accent-vivid);
}

.studio-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.group-name-input {
  width: 96px;
  height: 32px;
  flex-shrink: 0;
}

.preset-name-input {
  flex: 1;
  width: 100%;
  height: 32px;
}

.studio-action-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.save-main-btn {
  flex: 1;
}

/* ==================== 可选部件：分类加框 + 智能跨列圆角矩形 ==================== */
.ctrl-group-box {
  background: var(--dp-pill-inner);
  border: 1px solid var(--dp-border-strong);
  border-radius: 14px;
  padding: 9px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.ctrl-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px;
}

.ctrl-group-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--dp-text-sub);
  white-space: nowrap;
}

.ctrl-group-count {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--dp-text-dim);
  white-space: nowrap;
}

.ctrl-capsule-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-flow: row dense;
  gap: 6px;
}

.ctrl-capsule {
  height: 32px;
  padding: 0 10px;
  border-radius: 11px;
  border: none;
  background: var(--dp-card-bg);
  color: var(--dp-text-main);
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  min-width: 0;
}
.ctrl-capsule.full-row {
  grid-column: 1 / -1;
}
.ctrl-capsule:hover {
  background: var(--dp-card-hover);
}
.ctrl-capsule.active {
  background: var(--dp-accent);
  color: var(--dp-accent-text);
  box-shadow: 0 3px 10px -2px var(--dp-accent-glow);
}

.ctrl-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dp-text-dim);
  opacity: 0.45;
  flex-shrink: 0;
  transition:
    transform 420ms var(--spring-gentle),
    background-color 150ms ease,
    opacity 150ms ease;
}
.ctrl-capsule.active .ctrl-dot {
  background: currentColor;
  opacity: 1;
  transform: scale(1.18);
}

.ctrl-name {
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
  text-align: left;
}
.ctrl-capsule.active .ctrl-name {
  font-weight: 700;
}

@media (prefers-reduced-motion: reduce) {
  .companion-slide-enter-active,
  .companion-slide-leave-active,
  .bio-popover-enter-active,
  .bio-popover-leave-active,
  .bio-tab-switch-enter-active,
  .bio-tab-switch-leave-active,
  .bio-fold-collapse {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}

/* ==================== 无轨胶囊滑块 (Bio Scrub Sliders) ==================== */
.bio-slider-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bio-scrub {
  position: relative;
  height: 34px;
  border-radius: 11px;
  background: var(--dp-pill-inner);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 11px;
  transition: transform 480ms var(--spring-gentle) 45ms, box-shadow 200ms ease;
}
.bio-scrub:active {
  transform: scale(0.985);
  transition: transform 95ms cubic-bezier(0.22, 1, 0.36, 1) 0ms;
}

.bio-scrub-fill {
  position: absolute;
  top: 0;
  bottom: 0;
  background: var(--dp-accent-fill);
  pointer-events: none;
  transition: width 140ms var(--ease-out-expo);
}

.bio-scrub-label {
  position: relative;
  z-index: 1;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--dp-text-main);
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bio-scrub-val {
  position: relative;
  z-index: 2;
  border: none;
  background: transparent;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11px;
  font-weight: 700;
  color: var(--dp-text-sub);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 7px;
  white-space: nowrap;
  flex-shrink: 0;
  transition: transform 460ms var(--spring-gentle) 45ms, color 150ms ease, background-color 150ms ease;
}
.bio-scrub-val.modified {
  color: var(--dp-accent-vivid);
}
.bio-scrub-val:hover {
  background: var(--dp-card-hover);
}
.bio-scrub-val:active {
  transform: scale(0.92);
  transition: transform 95ms cubic-bezier(0.22, 1, 0.36, 1) 0ms;
}

.bio-range-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: ew-resize;
  margin: 0;
  z-index: 1;
}

/* ==================== 面板设置表单与色盘 ==================== */
.swatch-bar {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}

.swatch-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: transform 460ms var(--spring-gentle) 40ms, border-color 160ms ease;
}
.swatch-dot:active {
  transform: scale(0.9);
  transition: transform 95ms cubic-bezier(0.22, 1, 0.36, 1) 0ms;
}
.swatch-dot.active {
  border-color: var(--dp-text-main);
  transform: scale(1.16);
}

.custom-color-pill {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 10px;
  background: var(--dp-input-bg);
  color: var(--dp-text-main);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  white-space: nowrap;
  flex-shrink: 0;
}
.custom-color-pill input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.custom-color-preview {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}

.bio-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 2px;
}

.bio-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--dp-text-main);
  cursor: pointer;
  white-space: nowrap;
}
.bio-check input {
  accent-color: var(--dp-accent);
  cursor: pointer;
}

.bio-select {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border-radius: 11px;
  border: 1px solid transparent;
  background: var(--dp-input-bg);
  color: var(--dp-text-main);
  font-size: 12px;
  font-weight: 600;
  outline: none;
}
.bio-select:focus {
  border-color: var(--dp-accent-border);
}

.bio-field-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--dp-text-sub);
  margin-top: 2px;
  white-space: nowrap;
}

.bio-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.bio-hint {
  font-size: 12px;
  line-height: 1.55;
  color: var(--dp-text-sub);
  margin: 0;
}
</style>
