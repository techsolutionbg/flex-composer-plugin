// Flex Composer in the admin: the record chooser, the editor screen and "Отвори в Composer" in the lists of
// pages and products. The block editor itself is composer.js, loaded only when the editor screen opens.
export const BASE = '/admin/plugins/flex/composer';
export const PAGE = '/extension-pages/flex-composer-editor';
export const TYPES = {
  page: {label: 'Страници', one: 'страницата', saved: 'Страницата е записана.', list: '/pages', edit: (id) => '/pages/' + id + '/edit'},
  product: {label: 'Продукти', one: 'продукта', saved: 'Продуктът е записан.', list: '/extension-pages/flex-commerce-products', edit: (id) => '/extension-pages/flex-commerce-products/' + id + '/edit'},
};
export const CONFLICT = 'Записът е променен на друго място';

export function editorPath(type, id) {
  return PAGE + '/' + type + '/' + id;
}

/** The sub-path of the Composer page: "" (chooser), or the record being edited. */
export function parsePath(path) {
  const match = /^\/?(page|product)\/([1-9][0-9]{0,9})\/?$/.exec(String(path ?? '').replace(/^\/extension-pages\/flex-composer-editor/, ''));
  return match ? {type: match[1], id: Number(match[2])} : null;
}

function openAction(type) {
  return {
    label: 'Отвори в Composer',
    onSelect(row, helpers) {
      if (row?.id) helpers?.navigate?.(editorPath(type, row.id));
    },
    visible: (row) => !row?.deleted_at,
  };
}

/** "Отвори в Composer" in the actions menu of every page. */
export function createPageAction() {
  return openAction('page');
}

/** "Отвори в Composer" in the actions menu of every Flex Commerce product. */
export function createProductAction() {
  return openAction('product');
}

let runtime;

/** composer.js, once per admin session. */
export function loadComposer() {
  if (!runtime) {
    runtime = import(new URL('./composer.js', import.meta.url).href).catch((error) => {
      runtime = undefined;
      throw error;
    });
  }
  return runtime;
}

export function createPage(host) {
  const {React, request, toast} = host;
  const C = host.components;
  const h = React.createElement;

  function Heading({title, crumbs, navigate, children}) {
    return h('div', {className: 'react-page-heading composer-heading'},
      h('div', null,
        h('h1', null, title),
        h(C.Breadcrumbs, {items: crumbs, onHomeClick: () => navigate('/')})),
      children ? h('div', {className: 'composer-heading-actions'}, children) : null);
  }

  function Failure({message}) {
    return message ? h('div', {className: 'react-form-error', role: 'alert'}, message) : null;
  }

  function Chooser({navigate}) {
    const [types, setTypes] = React.useState(['page']);
    const [type, setType] = React.useState('page');
    const [search, setSearch] = React.useState('');
    const [rows, setRows] = React.useState([]);
    const [loading, setLoading] = React.useState(true);
    const [failure, setFailure] = React.useState('');
    React.useEffect(() => {
      const abort = new AbortController();
      const timer = setTimeout(() => {
        setLoading(true);
        request(BASE + '/records?type=' + type + '&q=' + encodeURIComponent(search.trim()), 'GET', undefined, abort.signal)
          .then((result) => {
            setTypes(result.types ?? ['page']);
            setRows(result.records ?? []);
            setFailure('');
          })
          .catch((error) => {
            if (!abort.signal.aborted) setFailure(error.message);
          })
          .finally(() => {
            if (!abort.signal.aborted) setLoading(false);
          });
      }, search ? 250 : 0);
      return () => {
        clearTimeout(timer);
        abort.abort();
      };
    }, [type, search]);
    const open = (row) => navigate(editorPath(type, row.id));
    return h(React.Fragment, null,
      h(Heading, {title: 'Composer', crumbs: [{label: 'Composer'}], navigate}),
      h('p', {className: 'composer-intro'}, 'Изберете запис, който да редактирате с блоковия редактор. Нови страници и продукти се създават от обичайните им екрани; Composer редактира съществуващи.'),
      h(Failure, {message: failure}),
      h(C.DataTable, {
        data: rows,
        loading,
        rowKey: (row) => row.id,
        emptyMessage: search ? 'Няма записи, които отговарят на търсенето.' : 'Няма записи.',
        filterStorageKey: 'flex-composer-chooser',
        toolbar: h('div', {className: 'composer-chooser-toolbar'},
          types.length > 1 ? h('div', {className: 'composer-type-switch', role: 'group', 'aria-label': 'Вид запис'},
            types.map((value) => h(C.Button, {
              key: value,
              type: 'button',
              variant: value === type ? 'primary' : 'secondary',
              'aria-pressed': value === type,
              onClick: () => setType(value),
            }, TYPES[value].label))) : null,
          h(C.Input, {type: 'search', value: search, placeholder: 'Търсене по заглавие', 'aria-label': 'Търсене по заглавие', onChange: (event) => setSearch(event.target.value)})),
        columns: [
          {key: 'title', label: 'Заглавие', sortable: true, sortValue: (row) => row.title.toLowerCase(), render: (row) => h('button', {type: 'button', className: 'composer-link-button', onClick: () => open(row)}, row.title || '(без заглавие)')},
          {key: 'status', label: 'Статус', sortable: true, render: (row) => statusLabel(row.status)},
          {key: 'updated_at', label: 'Променен', sortable: true, sortValue: (row) => host.time?.parse(row.updated_at)?.valueOf() ?? 0, render: (row) => row.updated_at ? h(C.DateTime, {value: row.updated_at}) : '—'},
          {key: 'composer', label: 'В Composer', render: (row) => row.composer_updated_at ? h(C.DateTime, {value: row.composer_updated_at}) : '—'},
          {key: 'actions', label: 'Действия', render: (row) => h(C.Button, {type: 'button', variant: 'secondary', onClick: () => open(row)}, 'Отвори')},
        ],
      }));
  }

  function Editor({type, id, navigate}) {
    const meta = TYPES[type];
    const [data, setData] = React.useState(null);
    const [failure, setFailure] = React.useState('');
    const [dirty, setDirty] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [conflict, setConflict] = React.useState(false);
    const [restoring, setRestoring] = React.useState(false);
    const [confirmRestore, setConfirmRestore] = React.useState(false);
    const [picker, setPicker] = React.useState(null);
    const [attempt, setAttempt] = React.useState(0);
    const holder = React.useRef(null);
    const instance = React.useRef(null);
    const changed = host.useWorkspaceChanged();
    const saved = host.useWorkspaceSaved();
    const markChanged = React.useRef(() => {});
    markChanged.current = () => {
      setDirty(true);
      changed?.();
    };

    React.useEffect(() => {
      const abort = new AbortController();
      setData(null);
      setFailure('');
      request(BASE + '/documents/' + type + '/' + id, 'GET', undefined, abort.signal)
        .then(setData)
        .catch((error) => {
          if (!abort.signal.aborted) setFailure(error.message);
        });
      return () => abort.abort();
    }, [type, id, attempt]);

    // The editor mounts once per loaded document; a reload after saving keeps it, since the editor already
    // holds what was saved.
    const generation = data ? data.record.id + ':' + data.version + ':' + data.state + ':' + attempt : '';
    const mounted = React.useRef('');
    React.useEffect(() => {
      if (!data || !holder.current || mounted.current === generation) return;
      let alive = true;
      loadComposer()
        .then((composer) => {
          if (!alive || !holder.current) return;
          instance.current?.unmount();
          instance.current = composer.mount(holder.current, {
            kind: type,
            document: data.document,
            html: data.record.html,
            pickMedia: (kind) => new Promise((resolve) => setPicker({kind, resolve})),
            onChange: () => markChanged.current(),
          });
          mounted.current = generation;
        })
        .catch((error) => {
          if (alive) setFailure('Редакторът не може да бъде зареден: ' + error.message);
        });
      return () => {
        alive = false;
      };
    }, [generation]);
    React.useEffect(() => () => {
      instance.current?.unmount();
      instance.current = null;
    }, []);

    async function save(force = false) {
      if (!instance.current || !data || saving) return;
      setSaving(true);
      setFailure('');
      try {
        const content = instance.current.getContent();
        const result = await request(BASE + '/documents/' + type + '/' + id, 'PUT', {document: content.document, html: content.html, base_hash: data.record.html_hash, force});
        mounted.current = result.record.id + ':' + result.version + ':' + result.state + ':' + attempt;
        setData(result);
        setDirty(false);
        setConflict(false);
        saved?.();
        toast.success(meta.saved);
      } catch (error) {
        if (String(error.message).startsWith(CONFLICT)) setConflict(true);
        else setFailure(error.message);
      } finally {
        setSaving(false);
      }
    }
    const saveRef = React.useRef(save);
    saveRef.current = save;
    React.useEffect(() => {
      const onKey = (event) => {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
          event.preventDefault();
          saveRef.current(false);
        }
      };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }, []);

    async function restore() {
      setRestoring(true);
      try {
        await request(BASE + '/documents/' + type + '/' + id + '/restore', 'POST', {});
        setConfirmRestore(false);
        setDirty(false);
        saved?.();
        toast.success('Възстановено е съдържанието отпреди Composer.');
        setAttempt((value) => value + 1);
      } catch (error) {
        setConfirmRestore(false);
        setFailure(error.message);
      } finally {
        setRestoring(false);
      }
    }

    const title = data ? data.record.title || '(без заглавие)' : 'Composer';
    return h(React.Fragment, null,
      h(Heading, {
        title,
        navigate,
        crumbs: [{label: 'Composer', onClick: () => navigate(PAGE)}, {label: meta.label, onClick: () => navigate(meta.list)}, {label: title}],
      },
      data?.record.url ? h('a', {className: 'react-action-button composer-secondary', href: data.record.url, target: '_blank', rel: 'noopener'}, 'Виж на сайта') : null,
      h(C.Button, {type: 'button', variant: 'secondary', onClick: () => navigate(meta.edit(id))}, 'Класически редактор'),
      h(C.LoadingButton, {type: 'button', loading: saving, disabled: !data || !dirty, onClick: () => save(false), title: 'Ctrl+S'}, dirty ? 'Запази' : 'Записано')),
      h(Failure, {message: failure}),
      data?.state === 'changed' ? h('div', {className: 'composer-notice', role: 'status'},
        'Съдържанието е променено в класическия редактор след последния запис в Composer. Блоковете са създадени отново от текущото съдържание.') : null,
      data?.state === 'new' ? h('div', {className: 'composer-notice', role: 'status'},
        'Съдържанието е преобразувано в блокове. Елементи, които не могат да станат блокове, са запазени като „HTML код“ без промяна. Нищо не се записва, докато не натиснете „Запази“.') : null,
      !data && !failure ? h('p', {role: 'status'}, 'Зареждане…') : null,
      !data && failure ? h(C.Button, {type: 'button', variant: 'secondary', onClick: () => setAttempt(attempt + 1)}, 'Опитай отново') : null,
      data ? h('div', {className: 'composer-surface' + (type === 'product' ? ' composer-product' : '')}, h('div', {ref: holder})) : null,
      data?.has_source ? h('div', {className: 'composer-footer'},
        h(C.Button, {type: 'button', variant: 'secondary', onClick: () => setConfirmRestore(true)}, 'Възстанови съдържанието отпреди Composer')) : null,
      h(C.ConfirmDialog, {
        open: conflict,
        title: 'Записът е променен',
        message: 'Някой е записал ' + meta.one + ' на друго място, докато редактирахте тук. Можете да затворите този прозорец и да презаредите екрана (промените ви тук ще се загубят) или да запишете вашата версия върху новата.',
        confirmLabel: 'Запиши върху промените',
        cancelLabel: 'Затвори',
        danger: true,
        busy: saving,
        onConfirm: () => save(true),
        onCancel: () => setConflict(false),
      }),
      h(C.ConfirmDialog, {
        open: confirmRestore,
        title: 'Възстановяване',
        message: 'Съдържанието ще стане такова, каквото беше преди първия запис в Composer, а блоковете ще бъдат изтрити. Промените след това ще се загубят.',
        confirmLabel: 'Възстанови',
        danger: true,
        busy: restoring,
        onConfirm: restore,
        onCancel: () => setConfirmRestore(false),
      }),
      h(C.MediaPicker, {
        open: picker !== null,
        imagesOnly: picker?.kind === 'image',
        onClose: () => {
          picker?.resolve(null);
          setPicker(null);
        },
        onSelect: (media) => {
          picker?.resolve({url: media.url, name: media.title || media.original_name, alt: media.alt});
          setPicker(null);
        },
      }));
  }

  // The admin does not load plugin stylesheets itself; composer.css holds the editor and these screens.
  const stylesheet = new URL('./composer.css', import.meta.url).pathname;
  return function ComposerPage({path, navigate}) {
    const target = parsePath(path);
    return h('div', {className: 'composer-page'},
      h('link', {rel: 'stylesheet', href: stylesheet}),
      target ? h(Editor, {key: target.type + target.id, type: target.type, id: target.id, navigate}) : h(Chooser, {navigate}));
  };
}

function statusLabel(status) {
  return {published: 'Публикувана', draft: 'Чернова', active: 'Активен', inactive: 'Неактивен', archived: 'Архивиран'}[status] ?? status;
}
