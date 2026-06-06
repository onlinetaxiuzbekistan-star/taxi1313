import type { Request, Response, NextFunction } from "express";
import type { ZodTypeAny } from "zod";

/**
 * Validate req.body against a Zod schema. On failure responds 400 with the
 * field-level issues. On success it does NOT replace req.body — handlers keep
 * reading the original object, so validation can never silently drop fields the
 * handler relies on. Schemas should mark only genuinely-required fields and use
 * .passthrough() so extra fields are accepted.
 */
export function validateBody(schema: ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: "validation_error",
        message: "Invalid request body",
        details: result.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }
    next();
  };
}
