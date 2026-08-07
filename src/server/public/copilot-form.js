// QuoteFleet — Copilot form registry (vanilla-JS parity with WeFixTrades'
// CopilotFormContext). Any route with an editable form registers its fields,
// a lazy getValues(), and an onApply(fills) handler; the floating copilot reads
// the most-recently-registered form via getActive() and prefills the REAL
// on-screen inputs (highlighted, pending) for the owner to Confirm / Undo.
//
// Classic script (loaded before app.js). Attaches a singleton to the global.
// Also exported for unit tests (Node) — the file is DOM-free except the tiny
// factory helper, which only touches the passed element's value/classList/
// dispatchEvent so it runs under Node's global Event too.
(function (global) {
  'use strict';

  // ── Registry singleton ──────────────────────────────────────────────
  // A stack of { id, reg }. The LAST registered form is the active one
  // (mirrors WFT: a page form + an open dialog → the dialog wins). Routes
  // re-render into #page-content, so app.js clears the registry on each
  // route change and every render fn re-registers.
  var stack = [];
  var registry = {
    register: function (id, reg) {
      stack = stack.filter(function (e) { return e.id !== id; });
      stack.push({ id: id, reg: reg });
    },
    unregister: function (id) {
      stack = stack.filter(function (e) { return e.id !== id; });
    },
    clear: function () { stack = []; },
    getActive: function () { return stack.length ? stack[stack.length - 1].reg : null; },
    // Test/inspection helper — never used by app code.
    _size: function () { return stack.length; },
  };

  // ── Registration factory ────────────────────────────────────────────
  // specs: [{ key, label, el, required?, options?, reveal? }]
  //   el       — the live <input>/<select> element the field maps to.
  //   options  — [{ value, label? }] for select fields (sent to the AI so it
  //              returns a valid option value; also validated here defensively).
  //   reveal   — optional fn(el) to bring a hidden field into view (e.g. open
  //              the mobile Customize sheet + scroll) before highlighting.
  //
  // Returns a CopilotFormRegistration: { formLabel, fields, getValues, onApply,
  // onConfirm, clearPending }.
  function makeCopilotFormReg(formLabel, specs) {
    specs = specs || [];
    var byKey = {};
    specs.forEach(function (s) { if (s && s.key) byKey[s.key] = s; });

    function fire(el, type) {
      try { el.dispatchEvent(new Event(type, { bubbles: true })); } catch (e) { /* non-DOM env */ }
    }

    return {
      formLabel: formLabel || '',
      // Field descriptors sent to the AI (no element refs — plain data).
      fields: specs.map(function (s) {
        var f = { key: s.key, label: s.label, required: !!s.required };
        if (s.options && s.options.length) f.options = s.options;
        return f;
      }),
      // Lazy — always reads the CURRENT input values.
      getValues: function () {
        var o = {};
        specs.forEach(function (s) { if (s.el) o[s.key] = s.el.value; });
        return o;
      },
      // Write each fill into its real input. Fires input+change so the page's
      // own save/validation/live-preview logic runs (per Phase-2 spec). When
      // pending (default) it marks the field with a review highlight and
      // reveals/scrolls it into view.
      onApply: function (fills, opts) {
        var pending = !opts || opts.pending !== false;
        (fills || []).forEach(function (f) {
          var s = byKey[f.field_key];
          if (!s || !s.el) return;
          s.el.value = f.value == null ? '' : String(f.value);
          fire(s.el, 'input');
          fire(s.el, 'change');
          if (pending) {
            if (s.el.classList) s.el.classList.add('qf-copilot-pending');
            if (typeof s.reveal === 'function') s.reveal(s.el);
            else if (typeof s.el.scrollIntoView === 'function') {
              try { s.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { s.el.scrollIntoView(); }
            }
          }
        });
      },
      // Persist the applied fields via the form's normal save. Default: dispatch
      // blur on each applied input (covers blur-saving grids + flushes the
      // Customize debounce). Callers may override for a form-level action
      // (e.g. the Accessorials "Add" button).
      onConfirm: function (keys) {
        (keys || []).forEach(function (k) {
          var s = byKey[k];
          if (s && s.el) fire(s.el, 'blur');
        });
      },
      clearPending: function () {
        specs.forEach(function (s) { if (s.el && s.el.classList) s.el.classList.remove('qf-copilot-pending'); });
      },
    };
  }

  var api = { registry: registry, makeCopilotFormReg: makeCopilotFormReg };

  // Browser: expose the singleton + factory. Tests: read them off globalThis.
  global.__qfCopilotForm = registry;
  global.__qfCopilotFormFactory = makeCopilotFormReg;
  // CommonJS interop (ignored under ESM / in the browser).
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
