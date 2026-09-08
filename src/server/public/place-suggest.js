/**
 * ADDRESS AUTOSUGGEST — attaches to any input carrying `data-place-suggest`.
 *
 * Progressive enhancement, in the strict sense: the field is a working text
 * input before this script runs and stays one if it never does. Every failure
 * path here — no network, a 500, a slow answer, JavaScript disabled entirely —
 * leaves the user typing into the same box and pressing the same button.
 *
 * WHY THIS IS NOT A `<datalist>`. The native element is one line of markup and
 * was the first thing tried. It cannot be styled to match the rest of the form
 * in any browser, it renders differently on every platform, it gives no control
 * over ordering, and Safari drops it on the floor. A form whose one smart
 * control looks foreign to the page it sits in is not the polish this was
 * asked for.
 *
 * KEYBOARD FIRST. Down and Up move through the list, Enter takes the active
 * item, Escape closes without changing the value, Tab commits what is typed.
 * The pattern is the ARIA combobox: `aria-expanded`, `aria-activedescendant`
 * and `role="option"` are set on the real elements, so a screen reader
 * announces the same list a sighted user sees.
 *
 * THE REQUEST IS DEBOUNCED AND RACE-PROOFED. Keystrokes fire faster than
 * round-trips return, and an out-of-order answer would repaint the list with
 * suggestions for a prefix the user has already moved past. Each request
 * carries a sequence number and a stale one is dropped rather than rendered.
 */
(function () {
  'use strict';

  var DEBOUNCE_MS = 120;
  var MIN_CHARS = 2;

  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function attach(input) {
    if (input.__placeSuggestBound) return;
    input.__placeSuggestBound = true;

    var listId = 'ps-' + Math.random().toString(36).slice(2, 9);
    var list = el('ul', 'ps-list');
    list.id = listId;
    list.setAttribute('role', 'listbox');
    list.hidden = true;

    // The list is positioned against the field's own wrapper so it tracks the
    // input on resize and scroll without any measurement code.
    var host = input.parentElement || input;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(list);

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', listId);
    // The browser's own history dropdown would cover ours.
    input.setAttribute('autocomplete', 'off');

    var items = [];
    var active = -1;
    var seq = 0;
    var timer = null;

    function close() {
      list.hidden = true;
      list.innerHTML = '';
      items = [];
      active = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    function setActive(next) {
      if (active >= 0 && list.children[active]) {
        list.children[active].classList.remove('is-active');
        list.children[active].setAttribute('aria-selected', 'false');
      }
      active = next;
      if (active >= 0 && list.children[active]) {
        var node = list.children[active];
        node.classList.add('is-active');
        node.setAttribute('aria-selected', 'true');
        input.setAttribute('aria-activedescendant', node.id);
        // Keyboard paging must not leave the active row out of view.
        if (node.scrollIntoView) node.scrollIntoView({ block: 'nearest' });
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    function commit(i) {
      if (i < 0 || !items[i]) return;
      input.value = items[i].label;
      close();
      // Anything listening for a typed change — validation, a dirty flag —
      // must see the selection as one.
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function render(next) {
      items = next;
      list.innerHTML = '';
      if (!items.length) {
        close();
        return;
      }
      items.forEach(function (place, i) {
        var li = el('li', 'ps-item');
        li.id = listId + '-o' + i;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        var name = el('span', 'ps-name');
        name.textContent = place.name;
        var st = el('span', 'ps-state');
        st.textContent = place.state;
        li.appendChild(name);
        li.appendChild(st);
        // `mousedown` rather than `click`: the input's blur fires first on a
        // click and would close the list before the handler ran.
        li.addEventListener('mousedown', function (e) {
          e.preventDefault();
          commit(i);
        });
        li.addEventListener('mouseenter', function () {
          setActive(i);
        });
        list.appendChild(li);
      });
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      setActive(-1);
    }

    function query() {
      var q = input.value.trim();
      if (q.length < MIN_CHARS) {
        close();
        return;
      }
      var mine = ++seq;
      fetch('/api/tools/place-suggest?q=' + encodeURIComponent(q), {
        headers: { Accept: 'application/json' },
      })
        .then(function (r) {
          return r.ok ? r.json() : { places: [] };
        })
        .then(function (data) {
          // A late answer for an earlier prefix must not repaint the list.
          if (mine !== seq) return;
          render((data && data.places) || []);
        })
        .catch(function () {
          // Offline, blocked, or the route is down. The field still works.
          if (mine === seq) close();
        });
    }

    input.addEventListener('input', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(query, DEBOUNCE_MS);
    });

    input.addEventListener('keydown', function (e) {
      if (list.hidden) {
        // Down on a closed list with enough text re-opens the last query
        // rather than doing nothing, which is what every native combobox does.
        if (e.key === 'ArrowDown' && input.value.trim().length >= MIN_CHARS) query();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(active + 1 >= items.length ? 0 : active + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(active - 1 < 0 ? items.length - 1 : active - 1);
      } else if (e.key === 'Enter') {
        // Enter with nothing highlighted must submit the form, not swallow the
        // keystroke — the user has typed a value they are happy with.
        if (active >= 0) {
          e.preventDefault();
          commit(active);
        } else {
          close();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'Tab') {
        close();
      }
    });

    input.addEventListener('blur', function () {
      // A blur that lands on our own list item is handled by `mousedown`.
      setTimeout(close, 0);
    });
  }

  function boot() {
    var inputs = document.querySelectorAll('input[data-place-suggest]');
    for (var i = 0; i < inputs.length; i += 1) attach(inputs[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
