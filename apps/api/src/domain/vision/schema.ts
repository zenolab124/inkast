import Ajv, { type AnySchema, type ValidateFunction } from "ajv";

const validators = new WeakMap<object, ValidateFunction>();

/** Reject known unsupported strict-output constructs before a paid API call. */
function assertStructuredSchema(schema: Record<string, unknown>): void {
  for (const key of ["allOf", "not", "dependentRequired", "dependentSchemas", "if", "then", "else", "prefixItems"]) {
    if (key in schema) throw new Error(`Unsupported structured-output keyword: ${key}`);
  }
  if (typeof schema.$ref === "string" && !schema.$ref.startsWith("#")) throw new Error("Remote schema references are disabled");
  if (schema.type === "object") {
    const properties = schema.properties as Record<string, unknown> | undefined;
    if (!properties || schema.additionalProperties !== false || !Array.isArray(schema.required) ||
        schema.required.length !== Object.keys(properties).length ||
        Object.keys(properties).some(key => !(schema.required as unknown[]).includes(key))) {
      throw new Error("Structured output objects require closed, fully required properties");
    }
  }
  for (const key of ["properties", "$defs", "definitions"]) {
    const children = schema[key];
    if (children && typeof children === "object" && !Array.isArray(children)) {
      for (const child of Object.values(children)) {
        if (child && typeof child === "object" && !Array.isArray(child)) assertStructuredSchema(child as Record<string, unknown>);
      }
    }
  }
  if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
    assertStructuredSchema(schema.items as Record<string, unknown>);
  }
  if (Array.isArray(schema.anyOf)) {
    for (const child of schema.anyOf) if (child && typeof child === "object") assertStructuredSchema(child);
  }
}

/** Compile only operator-owned schemas. No asynchronous/remote $ref loading. */
export function compileVisionSchema(schema: Record<string, unknown>): ValidateFunction {
  const existing = validators.get(schema);
  if (existing) return existing;
  assertStructuredSchema(schema);
  const validator = new Ajv({ strict: true, allErrors: false }).compile(schema as AnySchema);
  validators.set(schema, validator);
  return validator;
}
