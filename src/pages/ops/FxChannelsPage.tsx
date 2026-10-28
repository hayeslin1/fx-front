import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import type { Channel } from '@/domain/types';
import { formatDateTime } from '@/lib/format';
import {
  enabledStatusLabel,
  useFxChannelCommands,
  useFxChannelsView,
} from '@/features/fx-channels/hooks';

// 汇率运营-渠道管理（设计文档 §10.3「汇率运营」段、PRD §5.5）：
// 列表（渠道号/名称/状态徽标/创建时间/操作）＋ 新增表单（名称必填 + 启用开关）＋
// 行内「编辑」弹层（同 upsertChannel 带 id，仅改名称与状态）＋「启用/停用」toggleChannel（不物理删除）。
// 新增渠道由领域服务自动追加到各币对路由末尾（保持“路由覆盖全部渠道”），页内就地提示该行为。
// 数据读写全部经 features/fx-channels/hooks（§7.2），页面不直接触达 store。

/** 状态徽标配色（文字 + 颜色双通道，不靠颜色单独表意） */
const STATUS_BADGE_CLASS = {
  enabled: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  disabled: 'border-zinc-200 bg-zinc-50 text-zinc-600',
} as const;

function ChannelStatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <Badge variant="outline" className={STATUS_BADGE_CLASS[enabled ? 'enabled' : 'disabled']}>
      {enabledStatusLabel(enabled)}
    </Badge>
  );
}

export function FxChannelsPage() {
  const { channels } = useFxChannelsView();
  const commands = useFxChannelCommands();

  // ---------- 新增渠道（名称必填 + 启用开关） ----------
  const [createName, setCreateName] = useState('');
  const [createEnabled, setCreateEnabled] = useState(true);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreate = async () => {
    setCreateError(null);
    const result = await commands.saveChannel({ name: createName, enabled: createEnabled });
    if (!result.ok) {
      // 领域服务失败零变更（空名称等）：就地展示中文 message
      setCreateError(result.message);
      toast.error(result.message);
      return;
    }
    toast.success(`渠道 ${result.data.channel.id} 已新增，并已自动追加到全部币对的路由末尾`);
    setCreateName('');
    setCreateEnabled(true);
  };

  // ---------- 编辑渠道名称（弹层，编号与创建时间不变） ----------
  const [editing, setEditing] = useState<Channel | null>(null);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const openEdit = (channel: Channel) => {
    setEditing(channel);
    setEditName(channel.name);
    setEditError(null);
  };

  const handleEditSave = async () => {
    if (editing === null) return;
    setEditError(null);
    const result = await commands.saveChannel({
      id: editing.id,
      name: editName,
      enabled: editing.enabled,
    });
    if (!result.ok) {
      setEditError(result.message);
      toast.error(result.message);
      return;
    }
    toast.success(`渠道 ${result.data.channel.id} 已更新`);
    setEditing(null);
  };

  // ---------- 启用/停用（toggleChannel；停用不影响历史订单与快照） ----------
  const handleToggle = async (channel: Channel) => {
    const nextEnabled = !channel.enabled;
    const result = await commands.toggleChannel(channel.id, nextEnabled);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(
      nextEnabled
        ? `渠道 ${channel.name}（${channel.id}）已启用，重新参与报价选源与平仓可选渠道`
        : `渠道 ${channel.name}（${channel.id}）已停用，不再参与报价选源与平仓可选渠道`,
    );
  };

  const columns: DataTableColumn<Channel>[] = [
    {
      key: 'id',
      header: '渠道号',
      cell: (channel) => <span className="font-mono text-xs">{channel.id}</span>,
    },
    {
      key: 'name',
      header: '名称',
      cell: (channel) => <span className="font-medium whitespace-nowrap">{channel.name}</span>,
    },
    {
      key: 'status',
      header: '状态',
      cell: (channel) => <ChannelStatusBadge enabled={channel.enabled} />,
    },
    {
      key: 'createdAt',
      header: '创建时间',
      cell: (channel) => (
        <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {formatDateTime(channel.createdAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      cell: (channel) => (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="xs"
            disabled={commands.pending}
            onClick={() => openEdit(channel)}
          >
            编辑
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={commands.pending}
            onClick={() => void handleToggle(channel)}
          >
            {channel.enabled ? '停用' : '启用'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="渠道管理"
        description="渠道状态影响客户报价选源与平仓可选渠道；停用不影响历史订单与快照"
      />

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="text-base">新增渠道</CardTitle>
          <CardDescription>
            渠道名称必填；新增渠道将自动追加到全部币对的路由末尾（保持路由覆盖全部渠道）。
            渠道不做物理删除，停用后可随时重新启用。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="channel-name">渠道名称</Label>
              <Input
                id="channel-name"
                autoComplete="off"
                placeholder="如：测试渠道X"
                disabled={commands.pending}
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <span className="text-sm font-medium">初始状态</span>
              <label className="flex h-8 items-center gap-2 text-sm">
                <input
                  id="channel-enabled"
                  type="checkbox"
                  className="size-4 accent-emerald-600"
                  disabled={commands.pending}
                  checked={createEnabled}
                  onChange={(event) => setCreateEnabled(event.target.checked)}
                />
                {enabledStatusLabel(createEnabled)}（启用后立即参与报价选源）
              </label>
            </div>
          </div>

          {createError ? (
            <p role="alert" className="text-xs text-rose-600">
              {createError}
            </p>
          ) : null}

          <Button type="button" disabled={commands.pending} onClick={() => void handleCreate()}>
            {commands.pending ? '提交中…' : '新增渠道'}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          共 {channels.length} 个渠道（启停可逆；停用渠道的原始价保留，仅不再参与选源）
        </p>
        <DataTable
          columns={columns}
          rows={channels}
          rowKey={(channel) => channel.id}
          empty={<EmptyState title="暂无渠道" description="可通过上方表单新增第一个渠道。" />}
        />
      </div>

      {/* ---------- 编辑渠道弹层（同 upsertChannel 带 id：仅改名称/状态，编号与创建时间不变） ---------- */}
      <AlertDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>编辑渠道 {editing?.id ?? ''}</AlertDialogTitle>
            <AlertDialogDescription>
              仅修改渠道名称与启用状态，渠道号与创建时间不变；保存仅影响之后的新报价，
              历史订单与既有锁价快照不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2 text-left">
            <Label htmlFor="channel-edit-name">渠道名称</Label>
            <Input
              id="channel-edit-name"
              autoComplete="off"
              disabled={commands.pending}
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
            />
            {editError ? (
              <p role="alert" className="text-xs text-rose-600">
                {editError}
              </p>
            ) : null}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={commands.pending}
              onClick={(event) => {
                // 阻止 Action 默认关闭：校验失败时留在弹层内就地展示错误
                event.preventDefault();
                void handleEditSave();
              }}
            >
              {commands.pending ? '保存中…' : '保存'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
