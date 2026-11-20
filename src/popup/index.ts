import { STORAGE_KEY } from '../constants';
import type { MatchMode, Metric, Operator, Rule, Settings } from '../types';
import { getSettings } from '../utils/settings';

const SAVE_DELAY_MS = 300;

const METRIC_UNITS: Record<Metric, string> = {
  fileSizeKB: 'KB',
  width: 'px',
  height: 'px',
  oversizeRatio: 'x',
};

const NEW_RULE: Rule = { metric: 'fileSizeKB', operator: '>=', value: 500 };

const enabledCheckbox = document.querySelector<HTMLInputElement>('#is-enabled')!;
const matchModeRadios = document.querySelectorAll<HTMLInputElement>('input[name="match-mode"]');
const rulesList = document.querySelector<HTMLUListElement>('#rules')!;
const emptyHint = document.querySelector<HTMLParagraphElement>('#empty-hint')!;
const addRuleButton = document.querySelector<HTMLButtonElement>('#add-rule')!;
const ruleTemplate = document.querySelector<HTMLTemplateElement>('#rule-template')!;

let settings: Settings;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

// Debounced: storage.sync limits writes per minute, and typing fires many input events.
const saveSettings = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void chrome.storage.sync.set({ [STORAGE_KEY]: settings });
  }, SAVE_DELAY_MS);
};

const createRuleRow = (rule: Rule): HTMLLIElement => {
  const row = ruleTemplate.content.firstElementChild!.cloneNode(true) as HTMLLIElement;
  row.querySelector<HTMLSelectElement>('[name="metric"]')!.value = rule.metric;
  row.querySelector<HTMLSelectElement>('[name="operator"]')!.value = rule.operator;
  row.querySelector<HTMLInputElement>('[name="value"]')!.value = String(rule.value);
  row.querySelector('.unit')!.textContent = METRIC_UNITS[rule.metric];
  return row;
};

const renderRules = () => {
  rulesList.replaceChildren(...settings.rules.map(createRuleRow));
  emptyHint.hidden = settings.rules.length > 0;
};

const getRowIndex = (target: EventTarget | null): number => {
  const row = (target as Element | null)?.closest('.rule');
  return row ? [...rulesList.children].indexOf(row) : -1;
};

const handleRuleInput = (event: Event) => {
  const index = getRowIndex(event.target);
  if (index < 0) return;
  const field = event.target as HTMLInputElement | HTMLSelectElement;
  const rule = settings.rules[index];
  if (field.name === 'metric') {
    rule.metric = field.value as Metric;
    field.closest('.rule')!.querySelector('.unit')!.textContent = METRIC_UNITS[rule.metric];
  } else if (field.name === 'operator') {
    rule.operator = field.value as Operator;
  } else if (field.name === 'value') {
    const value = (field as HTMLInputElement).valueAsNumber;
    // Keep the last valid value while the input is empty or invalid.
    if (Number.isNaN(value) || value < 0) return;
    rule.value = value;
  }
  saveSettings();
};

const handleRuleRemoveClick = (event: Event) => {
  if (!(event.target as Element).closest('.remove')) return;
  settings.rules.splice(getRowIndex(event.target), 1);
  renderRules();
  saveSettings();
};

const init = async () => {
  settings = await getSettings();
  enabledCheckbox.checked = settings.isEnabled;
  matchModeRadios.forEach((radio) => {
    radio.checked = radio.value === settings.matchMode;
  });
  renderRules();

  enabledCheckbox.addEventListener('change', () => {
    settings.isEnabled = enabledCheckbox.checked;
    saveSettings();
  });
  matchModeRadios.forEach((radio) =>
    radio.addEventListener('change', () => {
      settings.matchMode = radio.value as MatchMode;
      saveSettings();
    }),
  );
  rulesList.addEventListener('input', handleRuleInput);
  rulesList.addEventListener('click', handleRuleRemoveClick);
  addRuleButton.addEventListener('click', () => {
    settings.rules.push({ ...NEW_RULE });
    renderRules();
    saveSettings();
  });
};

void init();
