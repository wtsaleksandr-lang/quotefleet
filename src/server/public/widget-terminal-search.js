(function () {
  'use strict';

  function labelForOption(opt) {
    if (!opt) return '';
    return (opt.textContent || '').replace(/^—\s*/, '').replace(/\s*—$/, '').trim();
  }

  function install() {
    var select = document.getElementById('qf-pickup-terminal');
    if (!select || select.dataset.searchInstalled === '1') return;
    select.dataset.searchInstalled = '1';

    var field = select.closest('.qf-field');
    if (!field) return;
    field.classList.add('qf-terminal-search-field', 'qf-typeahead');

    var input = document.createElement('input');
    input.className = 'qf-input';
    input.id = 'qf-pickup-terminal-search';
    input.autocomplete = 'off';
    input.placeholder = "I don't know yet";

    var box = document.createElement('div');
    box.className = 'qf-suggestions';
    box.id = 'qf-pickup-terminal-suggestions';

    select.style.position = 'absolute';
    select.style.left = '-9999px';
    select.style.width = '1px';
    select.style.height = '1px';
    select.style.opacity = '0';

    select.insertAdjacentElement('beforebegin', input);
    input.insertAdjacentElement('afterend', box);

    function options() {
      return Array.from(select.options || []);
    }

    function syncInput() {
      var selected = options().find(function (opt) { return opt.value === select.value; });
      input.value = select.value ? labelForOption(selected) : '';
      input.placeholder = options().length > 1 ? "I don't know yet" : 'Select pickup port first';
    }

    function close() {
      box.classList.remove('open');
      box.innerHTML = '';
    }

    function choose(opt) {
      select.value = opt.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      syncInput();
      close();
    }

    function render() {
      var q = input.value.trim().toLowerCase();
      var opts = options();
      box.innerHTML = '';
      if (opts.length <= 1) {
        var empty = document.createElement('div');
        empty.className = 'qf-suggestion';
        empty.textContent = 'Select a pickup port first';
        box.appendChild(empty);
        box.classList.add('open');
        return;
      }
      opts.filter(function (opt) {
        if (!opt.value) return true;
        return !q || labelForOption(opt).toLowerCase().includes(q) || opt.value.toLowerCase().includes(q);
      }).slice(0, 12).forEach(function (opt) {
        var item = document.createElement('div');
        item.className = 'qf-suggestion';
        item.textContent = opt.value ? labelForOption(opt) : "I don't know yet";
        if (opt.value) {
          var meta = document.createElement('span');
          meta.className = 'meta';
          meta.textContent = opt.value;
          item.appendChild(meta);
        }
        item.addEventListener('mousedown', function (ev) {
          ev.preventDefault();
          choose(opt);
        });
        box.appendChild(item);
      });
      box.classList.add('open');
    }

    input.addEventListener('focus', render);
    input.addEventListener('input', render);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') close();
      if (ev.key === 'Enter') {
        var first = box.querySelector('.qf-suggestion');
        if (first) {
          ev.preventDefault();
          first.dispatchEvent(new MouseEvent('mousedown'));
        }
      }
    });
    input.addEventListener('blur', function () { setTimeout(close, 140); });
    select.addEventListener('change', syncInput);

    new MutationObserver(syncInput).observe(select, { childList: true });
    syncInput();
  }

  document.addEventListener('DOMContentLoaded', install);
  new MutationObserver(install).observe(document.documentElement, { childList: true, subtree: true });
})();
