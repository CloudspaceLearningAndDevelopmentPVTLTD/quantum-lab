/**
 * embed.js — Quantum Lab's embeddable-widget loader. Dependency-free, ~60
 * lines of work. Full guide: docs/EMBED.md in the Quantum Lab repository.
 *
 * Declarative usage (auto-mounts every marked element):
 *
 *   <div data-quantum-lab data-circuit="TOKEN" data-readonly="1"></div>
 *   <script src="https://quantum-lab.example/embed.js" defer></script>
 *
 * Programmatic usage:
 *
 *   const widget = QuantumLab.mount(document.getElementById('slot'), {
 *     circuit: 'TOKEN',            // token from a /simulator?c=... share link
 *     readonly: true,              // viewers can run but not edit
 *     height: 520,                 // px; default 520
 *     onResult: (msg) => {},      // {type:'ql:result', counts, shots}
 *   })
 *   widget.load('OPENQASM 3; ...') // swap in a new circuit (queued until ready)
 *   widget.destroy()
 *
 * The widget origin is derived from this script's own src, so the same file
 * works on staging and production without edits. Messages are only accepted
 * from that origin and only from the widget's own window.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  var ORIGIN = new URL((script && script.src) || location.href).origin;

  function mount(el, opts) {
    opts = opts || {};
    var iframe = document.createElement('iframe');
    var query = [];
    if (opts.circuit) query.push('c=' + encodeURIComponent(opts.circuit));
    if (opts.readonly) query.push('readonly=1');
    iframe.src = ORIGIN + '/embed/circuit' + (query.length ? '?' + query.join('&') : '');
    iframe.title = 'Quantum Lab circuit simulator';
    iframe.style.width = '100%';
    iframe.style.height = (opts.height || 520) + 'px';
    iframe.style.border = '0';
    iframe.style.borderRadius = '12px';
    // No permissions beyond a plain document: the widget needs none.
    iframe.setAttribute('loading', 'lazy');

    var ready = false;
    var queued = null; // last load() before the widget said ql:ready

    function onMessage(event) {
      // Both checks matter: origin alone would accept another Quantum Lab
      // iframe on the same page; source alone would accept a spoofed origin.
      if (event.origin !== ORIGIN || event.source !== iframe.contentWindow) return;
      var data = event.data || {};
      if (data.type === 'ql:ready') {
        ready = true;
        if (queued !== null) {
          iframe.contentWindow.postMessage({ type: 'ql:load', qasm: queued }, ORIGIN);
          queued = null;
        }
      } else if (data.type === 'ql:result' && typeof opts.onResult === 'function') {
        opts.onResult(data);
      }
    }

    window.addEventListener('message', onMessage);
    el.appendChild(iframe);

    return {
      iframe: iframe,
      load: function (qasm) {
        if (ready && iframe.contentWindow) {
          iframe.contentWindow.postMessage({ type: 'ql:load', qasm: qasm }, ORIGIN);
        } else {
          queued = qasm;
        }
      },
      destroy: function () {
        window.removeEventListener('message', onMessage);
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      },
    };
  }

  // Auto-mount declarative embeds. Runs now if the DOM is ready (the script
  // is usually loaded with `defer`), otherwise waits for it.
  function autoMount() {
    var slots = document.querySelectorAll('[data-quantum-lab]:not([data-ql-mounted])');
    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      slot.setAttribute('data-ql-mounted', '');
      mount(slot, {
        circuit: slot.getAttribute('data-circuit') || undefined,
        readonly: slot.getAttribute('data-readonly') === '1',
        height: parseInt(slot.getAttribute('data-height') || '', 10) || undefined,
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMount);
  } else {
    autoMount();
  }

  window.QuantumLab = window.QuantumLab || { mount: mount };
})();
