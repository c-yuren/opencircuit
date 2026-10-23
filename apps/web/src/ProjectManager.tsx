import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { ProjectSummary } from '../../../packages/core/src/workspace';
import { catalog } from '../../../packages/core/src/catalog';
import { HardwareArt } from './HardwareArt';
import { api as request } from './api';
import { ContextMenu } from './ContextMenu';
import { Onboarding, onboardingSeen } from './Onboarding';
import { LanguageSwitch } from './Ui';
import { UpdateDialog, openIssueReport } from './SupportActions';
import { intlLocale, useT } from './i18n';
import { FolderOpen, Pencil, Copy, Trash2 } from 'lucide-react';

const templates = [
  { profile: 'led', name: 'LED 閃爍', typeId: 'official:led-red' },
  { profile: 'oled', name: '螢幕顯示', typeId: 'official:ssd1306-oled' },
  { profile: 'temperature', name: '溫度提醒', typeId: 'official:dht22' },
];

export function ProjectManager({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeFolder, setActiveFolder] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const [action, setAction] = useState<{
    kind: 'create' | 'rename' | 'copy' | 'delete';
    project?: ProjectSummary;
  } | null>(null);
  const [guide, setGuide] = useState(() => !onboardingSeen());
  const [updateOpen, setUpdateOpen] = useState(false);
  const [name, setName] = useState('');
  const [profile, setProfile] = useState('blank');
  const [menu, setMenu] = useState<{ x: number; y: number; project: ProjectSummary } | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await request('projects');
      setProjects(result.projects);
      setActiveFolder(result.activeFolder);
      setError('');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (action && !dialog.current?.open) {
      previousFocus.current = document.activeElement as HTMLElement;
      dialog.current?.showModal();
    }
    if (!action) previousFocus.current?.focus();
  }, [action]);

  const open = async (folder: string) => {
    setBusy(true);
    setError('');
    try {
      await request('project', { name: folder });
      onOpen();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!action) return;
    setBusy(true);
    setError('');
    try {
      const project = action.project;
      const result = await request(
        'projects/' + action.kind,
        project
          ? {
              folder: project.folder,
              name,
              expectedDigest: project.sourceDigest,
              baseRevision: project.revision,
            }
          : { name, profile },
      );
      setAction(null);
      await load();
      if (action.kind === 'create') await open(result.folder);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const begin = (
    kind: 'create' | 'rename' | 'copy' | 'delete',
    project?: ProjectSummary,
    template = 'blank',
  ) => {
    setError('');
    setProfile(template);
    setName(project ? project.name + (kind === 'copy' ? t(' 副本') : '') : '');
    setAction({ kind, project });
  };
  const visible = projects
    .filter((project) => project.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name, intlLocale())
        : b.modifiedAt.localeCompare(a.modifiedAt),
    );
  return (
    <div className="project-home">
      <header className="project-home-header">
        <div>
          <h1>OpenCircuit</h1>
          <span>{t('我的專案')}</span>
        </div>
        <div className="project-home-actions">
          <LanguageSwitch />
          <button title={t('在 GitHub 回報問題或提出建議')} onClick={openIssueReport}>
            {t('回報問題')}
          </button>
          <button title={t('連線到 GitHub 查詢最新版本')} onClick={() => setUpdateOpen(true)}>
            {t('檢查更新')}
          </button>
          <button onClick={() => setGuide(true)}>{t('新手引導')}</button>
          <button className="primary" disabled={busy} onClick={() => begin('create')}>
            {t('＋ 建立專案')}
          </button>
        </div>
      </header>
      <main className="project-home-main">
        <section className="project-templates" aria-label={t('範本')}>
          <h2>{t('範本')}</h2>
          <div className="project-template-list">
            {templates.map((template) => (
              <button
                key={template.profile}
                aria-label={t(template.name)}
                disabled={busy}
                onClick={() => begin('create', undefined, template.profile)}
              >
                <HardwareArt
                  definition={
                    catalog.definitions.find((definition) => definition.typeId === template.typeId)!
                  }
                />
                <span>{t(template.name)}</span>
                <span aria-hidden="true">＋</span>
              </button>
            ))}
          </div>
        </section>
        <div className="project-home-toolbar">
          <input
            aria-label={t('搜尋專案')}
            placeholder={t('搜尋專案名稱')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            aria-label={t('專案排序')}
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="recent">{t('最近修改')}</option>
            <option value="name">{t('名稱排序')}</option>
          </select>
          <button
            aria-label={t('重新整理專案')}
            title={t('重新整理專案')}
            disabled={loading || busy}
            onClick={() => void load()}
          >
            ↻
          </button>
          <span>{t('{count} 個專案', { count: projects.length })}</span>
        </div>
        {error && !action && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status" className="project-home-empty">
            {t('正在讀取專案…')}
          </p>
        ) : visible.length ? (
          <div className="project-list">
            {visible.map((project) => {
              const board = catalog.definitions.find(
                (definition) =>
                  definition.compileProfile === project.board &&
                  definition.category === 'controller',
              );
              return (
                <article
                  className="project-row"
                  key={project.folder}
                  tabIndex={0}
                  onContextMenu={(event) => {
                    if (
                      (event.target as HTMLElement).closest('input,textarea') ||
                      window.getSelection()?.toString()
                    )
                      return;
                    event.preventDefault();
                    setMenu({ x: event.clientX, y: event.clientY, project });
                  }}
                  onKeyDown={(event) => {
                    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
                      event.preventDefault();
                      const box = event.currentTarget.getBoundingClientRect();
                      setMenu({ x: box.x + 24, y: box.y + 24, project });
                    }
                  }}
                >
                  <div className="project-preview">
                    {board && <HardwareArt definition={board} />}
                  </div>
                  <div className="project-row-info">
                    <h2>{project.name}</h2>
                    {project.error ? (
                      <p className="error-text">{t(project.error)}</p>
                    ) : (
                      <p>
                        {board?.name ?? t(project.board ? '自訂板子' : '未選板子')} ·{' '}
                        {t('{count} 個元件', { count: project.components })}
                      </p>
                    )}
                    {project.modifiedAt && (
                      <time dateTime={project.modifiedAt}>
                        {new Date(project.modifiedAt).toLocaleString(intlLocale(), {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </time>
                    )}
                  </div>
                  {activeFolder === project.folder && (
                    <span className="project-active">{t('上次開啟')}</span>
                  )}
                  <button
                    disabled={busy || !!project.error}
                    onClick={() => void open(project.folder)}
                  >
                    {t('開啟')}
                  </button>
                  <details className="project-menu">
                    <summary
                      aria-label={t('{name}的更多操作', { name: project.name })}
                      title={t('更多操作')}
                    >
                      ⋯
                    </summary>
                    <div>
                      <button
                        disabled={busy || !!project.error}
                        onClick={(event) => {
                          event.currentTarget.closest('details')?.removeAttribute('open');
                          begin('rename', project);
                        }}
                      >
                        {t('改名')}
                      </button>
                      <button
                        disabled={busy || !!project.error}
                        onClick={(event) => {
                          event.currentTarget.closest('details')?.removeAttribute('open');
                          begin('copy', project);
                        }}
                      >
                        {t('建立副本')}
                      </button>
                      <button
                        className="danger-item"
                        disabled={busy}
                        onClick={(event) => {
                          event.currentTarget.closest('details')?.removeAttribute('open');
                          begin('delete', project);
                        }}
                      >
                        {t('刪除')}
                      </button>
                    </div>
                  </details>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="project-home-empty">
            <h2>{search ? t('沒有符合的專案') : t('尚無專案')}</h2>
            {search ? (
              <button onClick={() => setSearch('')}>{t('清除搜尋')}</button>
            ) : (
              <button onClick={() => begin('create')}>{t('建立專案')}</button>
            )}
          </div>
        )}
      </main>
      {updateOpen && <UpdateDialog onClose={() => setUpdateOpen(false)} />}
      {guide && (
        <Onboarding
          onClose={() => setGuide(false)}
          onStart={(template) => begin('create', undefined, template)}
        />
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: t('開啟'),
              icon: <FolderOpen size={16} />,
              disabled:
                busy || menu.project.error ? t('專案忙碌或來源有錯誤') : undefined,
              action: () => void open(menu.project.folder),
            },
            {
              label: t('改名'),
              icon: <Pencil size={16} />,
              disabled: busy ? t('操作中') : undefined,
              action: () => begin('rename', menu.project),
            },
            {
              label: t('複製'),
              icon: <Copy size={16} />,
              disabled: busy ? t('操作中') : undefined,
              action: () => begin('copy', menu.project),
            },
            {
              label: t('刪除'),
              icon: <Trash2 size={16} />,
              danger: true,
              disabled: busy ? t('操作中') : undefined,
              action: () => begin('delete', menu.project),
            },
          ]}
        />
      )}
      {action && (
        <dialog
          ref={dialog}
          className="project-dialog"
          onCancel={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!busy) setAction(null);
          }}
        >
          <h2>
            {action.kind === 'create'
              ? profile === 'blank'
                ? t('建立專案')
                : t('使用範本：{name}', {
                    name: t(templates.find((template) => template.profile === profile)?.name ?? ''),
                  })
              : action.kind === 'rename'
                ? t('專案改名')
                : action.kind === 'delete'
                  ? t('刪除專案')
                  : t('建立副本')}
          </h2>
          <form onSubmit={(event) => void submit(event)}>
            {action.kind === 'delete' && action.project && (
              <div className="project-delete-warning">
                <p>
                  {t('確定要刪除「')}
                  <strong>{action.project.name}</strong>
                  {t('」嗎？')}
                </p>
                <p>
                  {t('專案資料夾會移到工作區的')} <code>.trash</code>{' '}
                  {t('資料夾，不會立即消失；需要時可手動搬回工作區還原。')}
                </p>
                {activeFolder === action.project.folder && (
                  <p>{t('這是目前開啟的專案，刪除後會自動切換到其他專案。')}</p>
                )}
              </div>
            )}
            {action.kind !== 'delete' && (
              <label>
                {t('專案名稱')}
                <input
                  aria-label={t('專案名稱')}
                  autoFocus
                  required
                  maxLength={80}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
            )}
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button type="button" disabled={busy} onClick={() => setAction(null)}>
                {t('取消')}
              </button>
              <button
                className={action.kind === 'delete' ? 'danger' : 'primary'}
                disabled={busy || (action.kind !== 'delete' && !name.trim())}
              >
                {busy
                  ? t('處理中…')
                  : action.kind === 'create'
                    ? t('建立並開啟')
                    : action.kind === 'rename'
                      ? t('儲存名稱')
                      : action.kind === 'delete'
                        ? t('刪除專案')
                        : t('建立副本')}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </div>
  );
}
