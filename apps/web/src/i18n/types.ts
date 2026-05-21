export type Lang = "zh" | "en";

export interface Translations {
  app: {
    title: string;
    tagline: string;
  };
  tabs: {
    draft: string;
    gallery: string;
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
  size: {
    orientationLabel: string;
    ratioLabel: string;
    sizeLabel: string;
    orientationAuto: string;
    orientationSquare: string;
    orientationWide: string;
    orientationTall: string;
    orientationCustom: string;
    /** Label on the new "auto pixels under chosen ratio" chip in size row. */
    sizeAuto: string;
    autoNote: string;
    customRatioHint: string;
    customRatioNoSize: string;
    sizeNoPresets: string;
    width: string;
    height: string;
    clear: string;
    /** Suffix appended to the submit-size hint: "...· {disclaimer}" */
    disclaimer: string;
    widelyCompatibleLegend: string;
    customLabel: string;
    overrideNote: string;
  };
  composer: {
    label: string;
    placeholder: string;
    cancel: string;
    aiFill: string;
    aiFilling: string;
    generateNow: string;
    generateNowHint: string;
    generateNowPending: string;
    skipText: string;
    skipTextKbd: string;
    locked: string;
    lockedNoProse: string;
    unlock: string;
    backToDraft: string;
    m2Hint: string;
    reExpand: string;
    rawAfterLock: string;
    paramsDivider: string;
    reference: string;
    countLabel: string;
    countHint: string;
    formatLabel: string;
    formatHint: string;
    referenceAdd: string;
    referenceRemove: string;
    referenceFromGallery: string;
    referenceUpload: string;
    referenceSourceGallery: string;
    referenceSourceUpload: string;
    referencePickTitle: string;
    referenceUploadHint: string;
    referenceEmpty: string;
    referenceRemaining: string;
    referenceSelected: string;
    referenceAddSelected: string;
    referenceAlreadyAdded: string;
    referenceAlreadyAddedBadge: string;
    referenceUploadErrType: string;
    referenceUploadErrSize: string;
    referenceDropOverlay: string;
    backendVia: string;
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
    collapsed: {
      title: string;
      tipExpand: string;
      tipSkipRaw: string;
      groupNames: [string, string, string, string, string];
    };
  };
  workspace: {
    title: string;
    refreshNote: string;
    empty: string;
    emptyTip: string;
    emptyAdjust: string;
    countSuffix: string;
    completedLabel: string;
    activeLabel: string;
  };
  galleryPage: {
    searchPlaceholder: string;
    filterAll: string;
    empty: string;
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
    prose: string;
    proseFromUser: string;
    proseEmpty: string;
    proseExpand: string;
    proseCollapse: string;
    structured: string;
    structuredFromAi: string;
    structuredManual: string;
    aiBadge: string;
    meta: {
      createdAt: string;
      size: string;
      quality: string;
      duration: string;
      provider: string;
      model: string;
    };
  };
  config: {
    title: string;
    description: string;
    add: string;
    edit: string;
    addNew: string;
    none: string;
    noneLlm: string;
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
    tabs: {
      image: string;
      llm: string;
    };
    capabilities: string;
    activeDefault: string;
    enable: string;
    dragToReorder: string;
    builtinTag: string;
    probeModels: string;
    probeHint: string;
    errors: {
      needsKind: string;
      apiKeyRequired: string;
      probeNeedsBoth: string;
    };
    builtin: {
      claudeCode: string;
      claudeCodeDesc: string;
    };
    imageMode: {
      label: string;
      images: string;
      responses: string;
      hintImages: string;
      hintResponses: string;
    };
    imageRetry: {
      label: string;
      hint: string;
      placeholder: string;
    };
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
