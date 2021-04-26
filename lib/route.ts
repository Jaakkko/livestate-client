type Command = [string, string[]];
interface Parent {
  [key: string]: Parent | ((...args: unknown[]) => void);
}

export interface ConnectionEvents<State> {
  connectionClosed(): void;
  connectionStarted(state: State): void;
  stateChanged(updatedState: State): void;
}

export type Route<State> = (
  listener: ConnectionEvents<State>,
  pathParams: Record<string, string>
) => {
  cleanUp: () => void;
};

function executeCommand(
  parent: Parent,
  toBeParsed: Command | Record<string, Command>
): void {
  if (Array.isArray(toBeParsed)) {
    const [fName, args] = toBeParsed;
    const f = parent[fName] as (...args: unknown[]) => void;
    f.apply(parent, args);
  } else {
    const [key, newToBeParsed] = Object.entries(toBeParsed)[0];
    const newParent = parent[key] as Parent;
    executeCommand(newParent, newToBeParsed);
  }
}

export function createRoute<State>(
  pathSkeleton: string,
  structure: State
): Route<State> {
  // url/:arg1/dsa/:arg2 -> [ 'arg1', 'arg2' ]
  let pathParts = pathSkeleton.split("/:");
  pathParts.splice(0, 1);
  pathParts = pathParts.map((a) => a.split("/")[0]);

  const functions = Object.getOwnPropertyNames(structure).filter(
    (item) => typeof (structure as Record<string, unknown>)[item] === "function"
  );

  return (
    listener: ConnectionEvents<State>,
    pathParams: Record<string, string>
  ) => {
    // substitute params
    let path = pathSkeleton;
    pathParts.forEach((arg) => {
      const param = pathParams[arg];
      path = path.replace(":" + arg, param);
    });

    const url = new URL(path, window.location.href);
    url.protocol = url.protocol.replace("http", "ws");
    const ws = new WebSocket(url.href);
    ws.onclose = listener.connectionClosed;
    ws.onmessage = (firstMessage) => {
      const { s, i: id } = JSON.parse(firstMessage.data);
      let resolve: (() => void) | null = null;
      const internalState = s;
      functions.forEach((name) => {
        internalState[name] = async (...args: unknown[]) => {
          await new Promise<void>((r) => {
            resolve = r;
            ws.send(JSON.stringify({ [name]: args }));
          });
        };
      });

      listener.connectionStarted(internalState);

      ws.onmessage = (msg) => {
        const { c: commandList, i: callerId } = JSON.parse(msg.data);
        for (const command of commandList) {
          executeCommand(internalState, command);
        }

        if (resolve && callerId === id) {
          resolve();
          resolve = null;
        }

        if (!resolve) {
          listener.stateChanged(internalState);
        }
      };
    };

    return {
      cleanUp() {
        if (ws.readyState !== WebSocket.CLOSED) {
          ws.onclose = null;
          ws.close();
        }
      },
    };
  };
}
