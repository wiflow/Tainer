declare module "@novnc/novnc" {
  type NoVncEvent = {
    detail?: {
      clean?: boolean;
      reason?: string;
    };
  };

  export default class RFB {
    background: string;
    focusOnClick: boolean;
    resizeSession: boolean;
    scaleViewport: boolean;

    constructor(
      target: Element,
      url: string,
      options: {
        credentials: {
          password: string;
        };
        wsProtocols: string[];
      },
    );

    addEventListener(type: string, listener: (event: NoVncEvent) => void): void;
    disconnect(): void;
    focus(): void;
    sendCredentials(credentials: { password: string }): void;
    sendKey(keysym: number, code: number | null | undefined, down: boolean): void;
  }
}
