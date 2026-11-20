export type Metric = 'fileSizeKB' | 'width' | 'height' | 'oversizeRatio';

export type Operator = '>=' | '<=';

export type Rule = { metric: Metric; operator: Operator; value: number };

export type MatchMode = 'all' | 'any';

export type Settings = { isEnabled: boolean; matchMode: MatchMode; rules: Rule[] };

export type ImageMetrics = {
  url: string;
  // natural (intrinsic) pixel size
  width: number;
  height: number;
  // undefined when the element is not rendered
  oversizeRatio?: number;
  // undefined = not looked up yet, null = lookup failed
  fileSizeBytes?: number | null;
};

export type RuleResult = boolean | 'unknown';

export type GetFileSizesMessage = { type: 'GET_FILE_SIZES'; urls: string[] };

export type FileSizes = Record<string, number | null>;
