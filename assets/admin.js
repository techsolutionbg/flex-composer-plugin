// Flex Composer in the admin: the editor screen and "Отвори в Composer" in the actions menu of pages and
// Flex Commerce products. The screens are hidden admin pages, opened only from those actions. The block
// editor itself is composer.js, loaded only when the editor screen opens.
export const BASE = '/admin/plugins/flex/composer';
export const TYPES = {
  page: {label: 'Страници', one: 'страницата', saved: 'Страницата е записана.', list: '/pages', edit: (id) => '/pages/' + id + '/edit'},
  product: {label: 'Продукти', one: 'продукта', saved: 'Продуктът е записан.', list: '/extension-pages/flex-commerce-products', edit: (id) => '/extension-pages/flex-commerce-products/' + id + '/edit'},
};
export const CONFLICT = 'Записът е променен на друго място';

/** The admin opens plugin pages only at /extension-pages/{page}, /create and /{id}/edit. */
export function editorPath(type, id) {
  return '/extension-pages/flex-composer-' + type + '/' + id + '/edit';
}

/** The record of a Composer page address, or null. */
export function parsePath(path) {
  const match = /^\/extension-pages\/flex-composer-(page|product)\/([1-9][0-9]{0,9})\/edit$/.exec(String(path ?? ''));
  return match ? {type: match[1], id: Number(match[2])} : null;
}

function openAction(type) {
  return {
    label: 'Отвори в Composer',
    ...(type === 'page' ? {contentBuilder: 'flex/composer'} : {}),
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
    host.usePageHelp?.({title: 'Работа с Composer', content: guidance(h, type)});
    return h(React.Fragment, null,
      h(Heading, {
        title,
        navigate,
        crumbs: [{label: meta.label, onClick: () => navigate(meta.list)}, {label: title}, {label: 'Composer'}],
      },
      data?.record.url ? h(C.Button, {type: 'button', variant: 'secondary', onClick: () => window.open(data.record.url, '_blank', 'noopener')}, 'Виж на сайта') : null,
      h(C.Button, {type: 'button', variant: 'secondary', onClick: () => navigate(meta.edit(id))}, 'Класически редактор'),
      h(C.LoadingButton, {type: 'button', loading: saving, disabled: !data || !dirty, onClick: () => save(false), title: 'Ctrl+S'}, dirty ? 'Запази' : 'Записано')),
      h(Failure, {message: failure}),
      data?.state === 'changed' ? h('div', {className: 'composer-notice', role: 'status'},
        'Съдържанието е променено в класическия редактор след последния запис в Composer. Блоковете са създадени отново от текущото съдържание.') : null,
      data?.state === 'new' && C.Hint ? h(C.Hint, null, 'Съдържанието е преобразувано в блокове. Елементи, които не могат да станат блокове, са запазени като „HTML код“ без промяна. Нищо не се записва, докато не натиснете „Запази“.') : null,
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

  // The admin does not load plugin stylesheets itself; composer.css holds the editor and its screen.
  const stylesheet = new URL('./composer.css', import.meta.url).pathname;
  return function ComposerPage({path, navigate}) {
    const target = parsePath(path);
    return h('div', {className: 'composer-page'},
      h('link', {rel: 'stylesheet', href: stylesheet}),
      target
        ? h(Editor, {key: target.type + target.id, type: target.type, id: target.id, navigate})
        : h(React.Fragment, null,
          h(Heading, {title: 'Composer', crumbs: [{label: 'Composer'}], navigate}),
          h('p', {className: 'composer-intro'}, 'Отворете страница или продукт от „Действия“ → „Отвори в Composer“ в списъка им.'),
          h('div', null,
            h(C.Button, {type: 'button', variant: 'secondary', onClick: () => navigate('/pages')}, 'Към страниците'))));
  };
}

/** The guidance for the editor screen, shown in the admin's "Помощ" dialog. */
export function guidance(h, type) {
  const items = [
    'Нов блок: натиснете „/“ в празен ред или „+“ вляво от реда и изберете вида блок.',
    'Преместване: хванете дръжката ⋮⋮ вляво от блока и го провлачете. От същото меню блокът се изтрива или оцветява.',
    'Форматиране и връзки: маркирайте текст и използвайте лентата над него.',
    'Изображения: изберете блок „Изображение“, после „Медия“ → „Избери от медийната библиотека“ или въведете адрес.',
    type === 'page' ? 'Вграждане: блокът „Вграждане“ съдържа код като [gallery id="1"], който плъгините показват на сайта.' : null,
    type === 'page' ? 'HTML код: блокът „HTML код“ пази HTML точно както е въведен. В него остава и съдържание, което не може да стане блок.' : null,
    type === 'product' ? 'Продуктите имат само блокове, които магазинът показва: текст, заглавия, списъци, цитат, код и изображения.' : null,
    'Запис: „Запази“ или Ctrl+S. Нищо не се записва автоматично, а при излизане с незаписани промени се иска потвърждение.',
    'При първо отваряне съдържанието се преобразува в блокове. Ако записът бъде променен в класическия редактор, при следващото отваряне блоковете се създават отново от новото съдържание.',
    'Ако някой запише същия запис, докато го редактирате, записът спира и предлага да запишете върху промените.',
    '„Възстанови съдържанието отпреди Composer“ връща съдържанието отпреди първия запис тук.',
  ].filter(Boolean);
  return h('ul', null, items.map((text, index) => h('li', {key: index}, text)));
}

/**
 * "Отвори в Composer" inside the classic page and product editors (a section.start / section.end extension).
 * Shown only for saved records: Composer edits records that already exist.
 */
export function createEditorLink(host) {
  const h = host.React.createElement;
  const C = host.components;
  return function ComposerLink({context, navigate}) {
    const type = context?.type;
    const id = Number(context?.id);
    if ((type !== 'page' && type !== 'product') || !Number.isInteger(id) || id < 1) return null;
    const button = h(C.Button, {type: 'button', variant: 'secondary', onClick: () => navigate?.(editorPath(type, id))}, 'Отвори в Composer');
    if (type === 'page') return button;
    return h('div', {className: 'composer-editor-link', style: {display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', margin: '0 0 1rem'}},
      h('span', {style: {color: 'var(--text-secondary)'}}, 'Редактирайте съдържанието с блоковия редактор. Незаписаните промени тук не се пренасят в него.'),
      button);
  };
}
