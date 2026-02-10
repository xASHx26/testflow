/**
 * TestFlow — Modal Component
 * 
 * Reusable modal dialog for confirmations, prompts, and information.
 */

class Modal {
  constructor() {
    this.overlay = document.getElementById('modal-overlay');
    this._resolve = null;

    // Close on overlay click
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.overlay.classList.contains('hidden')) {
        this.close();
      }
    });
  }

  /**
   * Show an informational modal.
   */
  info(title, message) {
    return this._show(title, message, [
      { label: 'OK', className: 'btn-primary', value: true }
    ]);
  }

  /**
   * Show a confirmation modal.
   */
  confirm(title, message) {
    return this._show(title, message, [
      { label: 'Cancel', className: 'btn-secondary', value: false },
      { label: 'Confirm', className: 'btn-primary', value: true }
    ]);
  }

  /**
   * Show a prompt modal with an input field.
   */
  prompt(title, placeholder = '', defaultValue = '') {
    return new Promise((resolve) => {
      this._resolve = resolve;

      const content = `
        <div class="modal-content">
          <div class="modal-header">
            <h3>${this._esc(title)}</h3>
            <button class="modal-close">&times;</button>
          </div>
          <div class="modal-body">
            <input type="text" class="modal-input" placeholder="${this._esc(placeholder)}" value="${this._esc(defaultValue)}" />
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary modal-btn" data-value="cancel">Cancel</button>
            <button class="btn btn-primary modal-btn" data-value="ok">OK</button>
          </div>
        </div>
      `;

      this.overlay.innerHTML = content;
      this.overlay.classList.remove('hidden');

      const input = this.overlay.querySelector('.modal-input');
      input.focus();
      input.select();

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          this._resolve(input.value);
          this.close();
        }
      });

      this.overlay.querySelector('.modal-close').addEventListener('click', () => this.close());

      this.overlay.querySelectorAll('.modal-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.dataset.value === 'ok') {
            this._resolve(input.value);
          } else {
            this._resolve(null);
          }
          this.close();
        });
      });
    });
  }

  /**
   * Show a modal with custom HTML body.
   */
  custom(title, bodyHtml, buttons = []) {
    return this._show(title, bodyHtml, buttons, true);
  }

  _show(title, message, buttons, isHtml = false) {
    return new Promise((resolve) => {
      this._resolve = resolve;

      const bodyContent = isHtml ? message : `<p>${this._esc(message)}</p>`;

      const buttonsHtml = buttons.map(b =>
        `<button class="btn ${b.className} modal-btn" data-value="${b.value}">${this._esc(b.label)}</button>`
      ).join('');

      const content = `
        <div class="modal-content">
          <div class="modal-header">
            <h3>${this._esc(title)}</h3>
            <button class="modal-close">&times;</button>
          </div>
          <div class="modal-body">${bodyContent}</div>
          <div class="modal-footer">${buttonsHtml}</div>
        </div>
      `;

      this.overlay.innerHTML = content;
      this.overlay.classList.remove('hidden');

      this.overlay.querySelector('.modal-close').addEventListener('click', () => this.close());

      this.overlay.querySelectorAll('.modal-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const val = btn.dataset.value;
          this._resolve(val === 'true' ? true : val === 'false' ? false : val);
          this.close();
        });
      });
    });
  }

  close() {
    this.overlay.classList.add('hidden');
    this.overlay.innerHTML = '';
    if (this._resolve) {
      this._resolve(null);
      this._resolve = null;
    }
  }

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }
}

window.Modal = new Modal();
