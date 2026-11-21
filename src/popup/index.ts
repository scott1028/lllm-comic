import { API_KEY_STORAGE_KEY, STORAGE_KEY } from '../constants';
import type { MatchMode, Metric, Operator, Rule, Settings, TranslationSettings } from '../types';
import { getApiKey, getSettings } from '../utils/settings';

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
const translationEnabledCheckbox = document.querySelector<HTMLInputElement>('#is-translation-enabled')!;
const apiBaseUrlInput = document.querySelector<HTMLInputElement>('#api-base-url')!;
const apiKeyInput = document.querySelector<HTMLInputElement>('#api-key')!;
const modelOptions = document.querySelector<HTMLDataListElement>('#model-options')!;
const apiStatus = document.querySelector<HTMLParagraphElement>('#api-status')!;
const minFontSizeSelect = document.querySelector<HTMLSelectElement>('#min-font-size')!;
const translationTextInputs: [keyof Omit<TranslationSettings, 'isEnabled' | 'minFontSize'>, HTMLInputElement][] = [
  ['targetLanguage', document.querySelector<HTMLInputElement>('#target-language')!],
  ['apiBaseUrl', apiBaseUrlInput],
  ['model', document.querySelector<HTMLInputElement>('#model')!],
  ['reasoningEffort', document.querySelector<HTMLInputElement>('#reasoning-effort')!],
];
// Empty input keeps the last value for these; others may be empty.
const REQUIRED_TRANSLATION_FIELDS = new Set(['targetLanguage', 'apiBaseUrl']);

let settings: Settings;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let apiKeySaveTimer: ReturnType<typeof setTimeout> | undefined;

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

// Fills the model suggestions and shows whether the URL and key work.
const loadModelOptions = async () => {
  const apiKey = apiKeyInput.value.trim();
  try {
    const response = await fetch(`${settings.translation.apiBaseUrl.replace(/\/+$/, '')}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    if (!response.ok) {
      apiStatus.textContent = `無法連線：HTTP ${response.status}`;
      return;
    }
    const { data } = (await response.json()) as { data?: { id: string }[] };
    const modelIds = (data ?? []).map((model) => model.id);
    modelOptions.replaceChildren(
      ...modelIds.map((id) => Object.assign(document.createElement('option'), { value: id })),
    );
    apiStatus.textContent = `已連線：${modelIds.length} 個模型`;
  } catch (error) {
    apiStatus.textContent = `無法連線：${error instanceof Error ? error.message : String(error)}`;
  }
};

const initTranslationSettings = async () => {
  translationEnabledCheckbox.checked = settings.translation.isEnabled;
  translationEnabledCheckbox.addEventListener('change', () => {
    settings.translation.isEnabled = translationEnabledCheckbox.checked;
    saveSettings();
  });
  for (const [field, input] of translationTextInputs) {
    input.value = settings.translation[field];
    input.addEventListener('input', () => {
      const value = input.value.trim();
      if (!value && REQUIRED_TRANSLATION_FIELDS.has(field)) return;
      settings.translation[field] = value;
      saveSettings();
    });
  }
  apiBaseUrlInput.addEventListener('change', () => void loadModelOptions());

  minFontSizeSelect.value = String(settings.translation.minFontSize);
  minFontSizeSelect.addEventListener('change', () => {
    settings.translation.minFontSize = Number(minFontSizeSelect.value);
    saveSettings();
  });

  // Cleared input is saved like a manual delete, and its datalist lists every option again.
  document.querySelectorAll<HTMLButtonElement>('.clear').forEach((button) => {
    const input = button.closest('.clearable')!.querySelector('input')!;
    button.addEventListener('click', () => {
      input.value = '';
      input.dispatchEvent(new Event('input'));
      input.focus();
    });
  });

  apiKeyInput.value = await getApiKey();
  apiKeyInput.addEventListener('input', () => {
    clearTimeout(apiKeySaveTimer);
    apiKeySaveTimer = setTimeout(() => {
      void chrome.storage.local.set({ [API_KEY_STORAGE_KEY]: apiKeyInput.value.trim() });
    }, SAVE_DELAY_MS);
  });
  apiKeyInput.addEventListener('change', () => void loadModelOptions());
  void loadModelOptions();
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
  await initTranslationSettings();
};

void init();
