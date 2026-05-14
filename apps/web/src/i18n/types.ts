export type Lang = "zh" | "en";

export interface Translations {
  app: {
    title: string;
    tagline: string;
  };
  header: {
    config: string;
    dark: string;
    light: string;
    langZh: string;
    langEn: string;
  };
  banner: {
    aiFillFailed: string;
    generateFailed: string;
    ok: string;
    close: string;
  };
  composer: {
    label: string;
    optional: string;
    hint: string;
    placeholder: string;
    sample: string;
    cancel: string;
    aiFill: string;
    aiFillAgain: string;
    aiFilling: string;
    titleHintFresh: string;
    titleHintOverride: string;
    samples: string[];
    generateRaw: string;
    generateRawHint: string;
    generateRawPending: string;
    reference: string;
    referenceAdd: string;
    referenceRemove: string;
    referenceFromGallery: string;
    referenceUpload: string;
    referenceSourceGallery: string;
    referenceSourceUpload: string;
    referencePickTitle: string;
    referenceUploadHint: string;
    referenceEmpty: string;
  };
  jobs: {
    statusPending: string;
    statusRunning: string;
  };
  editor: {
    aiBadge: string;
    groups: Record<
      "basic" | "scene" | "mood" | "colors" | "text" | "others",
      { title: string; hint: string }
    >;
    fields: Record<
      | "type"
      | "style"
      | "subject"
      | "background"
      | "layout"
      | "mood"
      | "lighting"
      | "camera"
      | "colorPalette"
      | "textElements",
      string
    >;
    placeholders: {
      type: string;
      style: string;
      subject: string;
      background: string;
      layout: string;
      empty: string;
    };
    json: { show: string; hide: string; copy: string; copied: string };
    generate: { ready: string; pending: string };
  };
  palette: {
    emptyEditable: string;
    emptyReadonly: string;
    add: string;
    delete: string;
    presetLabel: string;
  };
  textElems: {
    emptyEditable: string;
    emptyReadonly: string;
    content: string;
    position: string;
    font: string;
    size: string;
    color: string;
    contentPlaceholder: string;
    add: string;
    itemPrefix: string;
  };
  gallery: {
    title: string;
    loading: string;
    loadError: string;
    reuse: string;
    download: string;
    openDetail: string;
  };
  detail: {
    title: string;
    prompt: string;
    copyJson: string;
    copied: string;
    reuse: string;
    download: string;
  };
  config: {
    title: string;
    description: string;
    add: string;
    edit: string;
    addNew: string;
    none: string;
    confirmDelete: string;
    loading: string;
    error: string;
    fields: {
      name: string;
      priority: string;
      baseUrl: string;
      model: string;
      apiKey: string;
      apiKeyEdit: string;
    };
    save: string;
    cancel: string;
  };
  picker: {
    titlePrefix: string;
    search: string;
    clear: string;
    noMatch: string;
    customLabel: string;
    customPlaceholder: string;
    confirm: string;
    cancel: string;
  };
  flash: {
    generateDone: string;
    skipped: string;
    noProvider: string;
    reuseLoaded: string;
  };
}
