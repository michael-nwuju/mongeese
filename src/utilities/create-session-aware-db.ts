import { Db, ClientSession } from "mongodb";

export function createSessionAwareDb(db: Db, session: ClientSession): Db {
  const dbProxy = new Proxy(db, {
    get(target, prop) {
      if (prop === "collection") {
        return (name: string, options?: any) => {
          const coll = target.collection(name, options);
          return new Proxy(coll, {
            get(cTarget, cProp) {
              const val = cTarget[cProp as keyof typeof cTarget];
              if (typeof val === "function") {
                return (...args: any[]) => {
                  // Inject session if last arg is options or add one
                  if (
                    args.length > 0 &&
                    typeof args[args.length - 1] === "object"
                  ) {
                    args[args.length - 1] = {
                      ...args[args.length - 1],
                      session,
                    };
                  } else {
                    args.push({ session });
                  }
                  return (val as Function).apply(cTarget, args);
                };
              }
              return val;
            },
          });
        };
      }
      return (target as any)[prop];
    },
  });
  return dbProxy;
}
