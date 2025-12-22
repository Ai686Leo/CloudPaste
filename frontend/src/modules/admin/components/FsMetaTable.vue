<template>
  <AdminTable
    :data="metaList"
    :columns="metaColumns"
    :column-classes="metaColumnClasses"
    :manual-sorting="false"
    :selectable="false"
    row-id-field="id"
    :empty-text="$t('admin.fsMeta.table.noData')"
  >
    <template #mobile="{ data }">
      <!-- 移动端卡片视图 -->
      <div v-for="meta in data" :key="meta.id" class="bg-white dark:bg-gray-800 border-b dark:border-gray-700 last:border-b-0">
        <div class="p-4">
          <!-- 路径标题 -->
          <div class="flex justify-between items-start mb-3">
            <div class="flex-1">
              <span class="font-mono font-semibold text-base" :class="darkMode ? 'text-white' : 'text-gray-900'">
                {{ meta.path }}
              </span>
            </div>
            <!-- 操作按钮组 -->
            <div class="flex space-x-2 ml-2">
              <button
                @click="emit('edit', meta)"
                class="p-1.5 rounded-full transition-colors"
                :class="darkMode ? 'text-blue-400 hover:bg-gray-700' : 'text-blue-600 hover:bg-gray-100'"
                title="编辑"
              >
                <IconRename aria-hidden="true" />
              </button>
              <button
                @click="emit('delete', meta)"
                class="p-1.5 rounded-full transition-colors"
                :class="darkMode ? 'text-red-400 hover:bg-gray-700' : 'text-red-600 hover:bg-gray-100'"
                title="删除"
              >
                <IconDelete aria-hidden="true" />
              </button>
            </div>
          </div>

          <!-- 详细信息 -->
          <div class="space-y-2 text-sm">
            <!-- 顶部说明 -->
            <div class="flex items-center">
              <span class="text-gray-500 dark:text-gray-400 w-20 flex-shrink-0">
                {{ $t("admin.fsMeta.table.headerMarkdown") }}:
              </span>
              <span v-if="meta.headerMarkdown" class="flex items-center" :class="darkMode ? 'text-green-400' : 'text-green-600'">
                <IconCheck size="sm" class="mr-1" aria-hidden="true" />
                {{ $t("admin.fsMeta.common.set") }}{{ meta.headerInherit ? $t("admin.fsMeta.common.inheritedSuffix") : "" }}
              </span>
              <span v-else class="text-gray-400">
                {{ $t("admin.fsMeta.common.notSet") }}
              </span>
            </div>

            <!-- 底部说明 -->
            <div class="flex items-center">
              <span class="text-gray-500 dark:text-gray-400 w-20 flex-shrink-0">
                {{ $t("admin.fsMeta.table.footerMarkdown") }}:
              </span>
              <span v-if="meta.footerMarkdown" class="flex items-center" :class="darkMode ? 'text-green-400' : 'text-green-600'">
                <IconCheck size="sm" class="mr-1" aria-hidden="true" />
                {{ $t("admin.fsMeta.common.set") }}{{ meta.footerInherit ? $t("admin.fsMeta.common.inheritedSuffix") : "" }}
              </span>
              <span v-else class="text-gray-400">
                {{ $t("admin.fsMeta.common.notSet") }}
              </span>
            </div>

            <!-- 隐藏规则 -->
            <div class="flex items-center">
              <span class="text-gray-500 dark:text-gray-400 w-20 flex-shrink-0">
                {{ $t("admin.fsMeta.table.hidePatterns") }}:
              </span>
              <span v-if="meta.hidePatterns && meta.hidePatterns.length > 0" class="flex items-center" :class="darkMode ? 'text-blue-400' : 'text-blue-600'">
                {{
                  $t("admin.fsMeta.hidePatternsStatus.count", {
                    count: meta.hidePatterns.length,
                  })
                }}{{ meta.hideInherit ? $t("admin.fsMeta.common.inheritedSuffix") : "" }}
              </span>
              <span v-else class="text-gray-400">
                {{ $t("admin.fsMeta.common.notSet") }}
              </span>
            </div>

            <!-- 密码保护 -->
            <div class="flex items-center">
              <span class="text-gray-500 dark:text-gray-400 w-20 flex-shrink-0">
                {{ $t("admin.fsMeta.table.password") }}:
              </span>
              <span v-if="meta.hasPassword" class="text-xs" :class="darkMode ? 'text-amber-300' : 'text-amber-700'">
                {{
                  meta.passwordInherit
                    ? $t("admin.fsMeta.passwordStatus.inherited")
                    : $t("admin.fsMeta.passwordStatus.protected")
                }}
              </span>
              <span v-else class="text-gray-400 text-xs">
                {{ $t("admin.fsMeta.common.notSet") }}
              </span>
            </div>

            <!-- 创建时间 -->
            <div class="flex items-center text-xs" :class="darkMode ? 'text-gray-500' : 'text-gray-400'">
              <span class="w-20 flex-shrink-0">
                {{ $t("admin.fsMeta.table.createdAt") }}:
              </span>
              <span>{{ formatDate(meta.createdAt) }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </AdminTable>
</template>

<script setup>
import { computed, h } from "vue";
import { useI18n } from "vue-i18n";
import AdminTable from "@/components/common/AdminTable.vue";
import { IconCheck, IconDelete, IconRename } from "@/components/icons";
import { formatDateTime } from "@/utils/timeUtils.js";

const props = defineProps({
  darkMode: {
    type: Boolean,
    required: true,
  },
  metaList: {
    type: Array,
    required: true,
  },
  loading: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["edit", "delete"]);

const { t } = useI18n();

// 格式化日期
const formatDate = (dateString) => {
  return formatDateTime(dateString);
};

// 渲染现代化状态徽章（pill badge 设计，参考 Tabler Admin 和 Carbon Design）
const renderStatusBadge = (hasValue, inherit, darkMode) => {
  if (!hasValue) {
    return h(
      "span",
      {
        class: "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium " +
               (darkMode ? "bg-gray-700 text-gray-400" : "bg-gray-100 text-gray-500"),
      },
      "-"
    );
  }

  // 已设置且继承
  if (inherit) {
    return h(
      "span",
      {
        class: "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium " +
               (darkMode ? "bg-blue-500/20 text-blue-300 border border-blue-400/30" : "bg-blue-50 text-blue-700 border border-blue-200"),
      },
      [
        h(
          "svg",
          {
            xmlns: "http://www.w3.org/2000/svg",
            class: "h-3 w-3",
            fill: "none",
            viewBox: "0 0 24 24",
            stroke: "currentColor",
          },
          [
            h("path", {
              "stroke-linecap": "round",
              "stroke-linejoin": "round",
              "stroke-width": "2",
              d: "M13 10V3L4 14h7v7l9-11h-7z",
            }),
          ]
        ),
        t("admin.fsMeta.common.inherited")
      ]
    );
  }

  // 已设置但不继承
  return h(
    "span",
    {
      class: "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium " +
             (darkMode ? "bg-green-500/20 text-green-300 border border-green-400/30" : "bg-green-50 text-green-700 border border-green-200"),
    },
    [
      h(
        "svg",
        {
          xmlns: "http://www.w3.org/2000/svg",
          class: "h-3 w-3",
          fill: "none",
          viewBox: "0 0 24 24",
          stroke: "currentColor",
        },
        [
          h("path", {
            "stroke-linecap": "round",
            "stroke-linejoin": "round",
            "stroke-width": "2",
            d: "M5 13l4 4L19 7",
          }),
        ]
      ),
      t("admin.fsMeta.common.set")
    ]
  );
};

// 定义表格列
const metaColumns = computed(() => [
  {
    key: "path",
    type: "accessor",
    header: t("admin.fsMeta.table.path"),
    sortable: true,
    render: (_, meta) => {
      if (!meta) return h("span", t("admin.fsMeta.common.noDataCell"));
      return h(
        "span",
        {
          class: ["font-mono text-sm", props.darkMode ? "text-gray-100" : "text-gray-900"],
        },
        meta.path
      );
    },
  },
  {
    key: "headerMarkdown",
    type: "display",
    header: t("admin.fsMeta.table.headerMarkdown"),
    sortable: false,
    render: (meta) => {
      if (!meta) return h("span", t("admin.fsMeta.common.noDataCell"));
      return renderStatusBadge(meta.headerMarkdown, meta.headerInherit, props.darkMode);
    },
  },
  {
    key: "footerMarkdown",
    type: "display",
    header: t("admin.fsMeta.table.footerMarkdown"),
    sortable: false,
    render: (meta) => {
      if (!meta) return h("span", t("admin.fsMeta.common.noDataCell"));
      return renderStatusBadge(meta.footerMarkdown, meta.footerInherit, props.darkMode);
    },
  },
  {
    key: "hidePatterns",
    type: "display",
    header: t("admin.fsMeta.table.hidePatterns"),
    sortable: false,
    render: (meta) => {
      if (!meta) return h("span", t("admin.fsMeta.common.noDataCell"));

      if (!meta.hidePatterns || meta.hidePatterns.length === 0) {
        return h(
          "span",
          {
            class: "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium " +
                   (props.darkMode ? "bg-gray-700 text-gray-400" : "bg-gray-100 text-gray-500"),
          },
          "-"
        );
      }

      // 有隐藏规则且继承
      if (meta.hideInherit) {
        return h(
          "span",
          {
            class: "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium " +
                   (props.darkMode ? "bg-purple-500/20 text-purple-300 border border-purple-400/30" : "bg-purple-50 text-purple-700 border border-purple-200"),
          },
          [
            h(
              "svg",
              {
                xmlns: "http://www.w3.org/2000/svg",
                class: "h-3 w-3",
                fill: "none",
                viewBox: "0 0 24 24",
                stroke: "currentColor",
              },
              [
                h("path", {
                  "stroke-linecap": "round",
                  "stroke-linejoin": "round",
                  "stroke-width": "2",
                  d: "M13 10V3L4 14h7v7l9-11h-7z",
                }),
              ]
            ),
            t("admin.fsMeta.hidePatternsStatus.count", {
              count: meta.hidePatterns.length,
            }) + t("admin.fsMeta.common.inheritedSuffix")
          ]
        );
      }

      // 有隐藏规则但不继承
      return h(
        "span",
        {
          class: "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium " +
                 (props.darkMode ? "bg-purple-500/20 text-purple-300 border border-purple-400/30" : "bg-purple-50 text-purple-700 border border-purple-200"),
        },
        t("admin.fsMeta.hidePatternsStatus.count", {
          count: meta.hidePatterns.length,
        })
      );
    },
  },
  {
    key: "password",
    type: "display",
    header: t("admin.fsMeta.table.password"),
    sortable: false,
    render: (meta) => {
      if (!meta) return h("span", t("admin.fsMeta.common.noDataCell"));

      const password = meta.password || "";
      if (!password) {
        return h(
          "span",
          {
            class:
              "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium " +
              (props.darkMode ? "bg-gray-700 text-gray-400" : "bg-gray-100 text-gray-500"),
          },
          t("admin.fsMeta.common.notSet")
        );
      }

      return h(
        "span",
        {
          class:
            "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-mono " +
            (props.darkMode ? "bg-gray-800 text-amber-200 border border-amber-500/40" : "bg-amber-50 text-amber-700 border border-amber-200"),
        },
        password
      );
    },
  },
  {
    key: "createdAt",
    type: "accessor",
    header: t("admin.fsMeta.table.createdAt"),
    sortable: true,
    render: (_, meta) => {
      if (!meta) return h("span", t("admin.fsMeta.common.noDataCell"));
      return h(
        "span",
        {
          class: "text-xs " + (props.darkMode ? "text-gray-400" : "text-gray-600"),
        },
        formatDate(meta.createdAt)
      );
    },
  },
  {
    key: "actions",
    type: "display",
    header: t("admin.fsMeta.table.actions"),
    sortable: false,
    render: (meta) => {
      if (!meta) return h("span", t("admin.fsMeta.common.noDataCell"));
      return h("div", { class: "flex space-x-2" }, [
        // 编辑按钮
        h(
          "button",
          {
            class:
              "p-1.5 rounded-full transition-colors " +
              (props.darkMode ? "text-blue-400 hover:bg-gray-700 hover:text-blue-300" : "text-blue-600 hover:bg-gray-100 hover:text-blue-700"),
            title: t("admin.fsMeta.actions.edit"),
            onClick: () => emit("edit", meta),
          },
          [
            h(
              "svg",
              {
                xmlns: "http://www.w3.org/2000/svg",
                class: "h-5 w-5",
                fill: "none",
                viewBox: "0 0 24 24",
                stroke: "currentColor",
              },
              [
                h("path", {
                  "stroke-linecap": "round",
                  "stroke-linejoin": "round",
                  "stroke-width": "2",
                  d: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
                }),
              ]
            ),
          ]
        ),
        // 删除按钮
        h(
          "button",
          {
            class:
              "p-1.5 rounded-full transition-colors " +
              (props.darkMode ? "text-red-400 hover:bg-gray-700 hover:text-red-300" : "text-red-600 hover:bg-gray-100 hover:text-red-700"),
            title: t("admin.fsMeta.actions.delete"),
            onClick: () => emit("delete", meta),
          },
          [
            h(
              "svg",
              {
                xmlns: "http://www.w3.org/2000/svg",
                class: "h-5 w-5",
                fill: "none",
                viewBox: "0 0 24 24",
                stroke: "currentColor",
              },
              [
                h("path", {
                  "stroke-linecap": "round",
                  "stroke-linejoin": "round",
                  "stroke-width": "2",
                  d: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
                }),
              ]
            ),
          ]
        ),
      ]);
    },
  },
]);

// 列样式配置
const metaColumnClasses = computed(() => ({
  path: "",
  headerMarkdown: "hidden sm:table-cell text-center",
  footerMarkdown: "hidden sm:table-cell text-center",
  hidePatterns: "hidden md:table-cell text-center",
  password: "hidden md:table-cell text-center",
  createdAt: "hidden lg:table-cell text-center",
  actions: "text-center",
}));
</script>
