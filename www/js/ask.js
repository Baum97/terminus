// Eigene Rückfrage statt prompt()/confirm() des Browsers: passt zur App, funktioniert überall gleich.
const $ = (sel, root = document) => root.querySelector(sel);

// ask({ title, text?, label?, placeholder?, ok? }) → eingegebener Text, true (ohne Eingabefeld) oder null
export function ask({ title, text = '', label = '', placeholder = '', ok = 'OK', value = '' }) {
  const dlg = $('#dlg-ask');
  $('#ask-h').textContent = title;
  $('#ask-text').textContent = text;
  $('#ask-text').hidden = !text;
  const field = $('#ask-field');
  field.hidden = !label;
  $('#ask-label').textContent = label;
  const input = $('#ask-input');
  input.value = value;
  input.placeholder = placeholder;
  $('#ask-ok').textContent = ok;
  dlg.returnValue = '';
  dlg.showModal();
  if (label) setTimeout(() => input.focus(), 50);
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      if (dlg.returnValue !== 'ok') return resolve(null);
      resolve(label ? input.value.trim() || null : true);
    }, { once: true });
  });
}
