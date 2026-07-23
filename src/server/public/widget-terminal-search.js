(function () {
  'use strict';

  function labelForOption(opt) {
    if (!opt) return '';
    return (opt.textContent || '').replace(/^—\s*/, '').replace(/\s*—$/, '').trim();
  }

  function optionTokens(opt) {
    if (!opt) return '';
    return [opt.value || '', labelForOption(opt)].join(' ').toLowerCase();
  }

  function install() {
    var select = document.getElementById('qf-pickup-terminal');
    if (!select || select.dataset.searchInstalled === '1') return;
    select.dataset.searchInstalled = '1';

    var field = select.closest('.qf-field');
    if (!field) return;
    field.classList.add('qf-terminal-search-field', 'qf-typeahead');

    var input = document.createElement('input');
    input.className = 'qf-input qf-terminal-search-input';
    input.id = 'qf-pickup-terminal-search';
    input.autocomplete = 'off';
    input.placeholder = "I don't know yet";
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', 'qf-pickup-terminal-suggestions');

    var box = document.createElement('div');
    box.className = 'qf-suggestions qf-terminal-suggestions';
    box.id = 'qf-pickup-terminal-suggestions';

    var help = document.createElement('div');
    help.className = 'qf-terminal-search-help';
    help.textContent = 'Start typing the terminal name, carrier, or code. Leave blank if you are not sure.';

    select.style.position = 'absolute';
    select.style.left = '-9999px';
    select.style.width = '1px';
    select.style.height = '1px';
    select.style.opacity = '0';

    select.insertAdjacentElement('beforebegin', input);
    input.insertAdjacentElement('afterend', box);
    box.insertAdjacentElement('afterend', help);

    function options() {
      return Array.from(select.options || []);
    }

    function shortLabel(opt) {
      // Drop the trailing "  (carrier)" suffix so a SELECTED terminal fits the
      // narrow input; the carrier still shows in the suggestion dropdown, and the
      // full name is on the input's title (hover) + ellipsized by CSS.
      return labelForOption(opt).split('  (')[0].trim();
    }
    function syncInput() {
      var selected = options().find(function (opt) { return opt.value === select.value; });
      input.value = select.value ? shortLabel(selected) : '';
      input.title = select.value ? labelForOption(selected) : '';
      input.placeholder = options().length > 1 ? "I don't know yet" : 'Select pickup port first';
    }

    function close() {
      box.classList.remove('open');
      box.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
    }

    function choose(opt) {
      select.value = opt.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      syncInput();
      close();
    }

    function addItem(text, opt, metaText) {
      var item = document.createElement('div');
      item.className = 'qf-suggestion qf-terminal-suggestion';
      // Wrap the name in its own span so it can ellipsize instead of pushing the
      // carrier/code meta pill off the row when the terminal name is long.
      var label = document.createElement('span');
      label.className = 'qf-terminal-suggestion-label';
      label.textContent = text;
      item.appendChild(label);
      if (metaText) {
        var meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = metaText;
        item.appendChild(meta);
      }
      if (opt) {
        item.addEventListener('mousedown', function (ev) {
          ev.preventDefault();
          choose(opt);
        });
      }
      box.appendChild(item);
    }

    function render() {
      var q = input.value.trim().toLowerCase();
      var opts = options();
      var unknown = opts.find(function (opt) { return !opt.value; });
      var searchable = opts.filter(function (opt) { return !!opt.value; });
      var matches = searchable.filter(function (opt) {
        return !q || optionTokens(opt).indexOf(q) >= 0;
      });

      box.innerHTML = '';
      if (opts.length <= 1) {
        addItem('Select a pickup port first', null, 'Port required');
      } else {
        if (!q && unknown) addItem("I don't know yet", unknown, 'Dispatcher will confirm');
        if (q && !matches.length) {
          addItem('No matching terminal found', null, 'Try carrier, code, or leave blank');
          if (unknown) addItem("I don't know yet", unknown, 'Use this if unsure');
        }
        matches.slice(0, 12).forEach(function (opt) {
          addItem(labelForOption(opt), opt, opt.value);
        });
      }
      box.classList.add('open');
      input.setAttribute('aria-expanded', 'true');
    }

    input.addEventListener('focus', render);
    input.addEventListener('input', render);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') close();
      if (ev.key === 'Enter') {
        var first = box.querySelector('.qf-terminal-suggestion');
        if (first) {
          ev.preventDefault();
          first.dispatchEvent(new MouseEvent('mousedown'));
        }
      }
    });
    input.addEventListener('blur', function () { setTimeout(close, 140); });
    select.addEventListener('change', syncInput);

    new MutationObserver(function () {
      syncInput();
      if (box.classList.contains('open')) render();
    }).observe(select, { childList: true });
    syncInput();
  }

  document.addEventListener('DOMContentLoaded', install);
  new MutationObserver(install).observe(document.documentElement, { childList: true, subtree: true });
})();