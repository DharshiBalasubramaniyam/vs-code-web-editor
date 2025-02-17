import * as vscode from 'vscode';
import * as lc from 'vscode-languageclient/browser';

let client: lc.LanguageClient | undefined;
interface WorkspaceFolderPath {
	relativePath: string,
	absolutePath: string
}
const WorkspaceFoldersNotification = new lc.NotificationType<WorkspaceFolderPath[]>(
    'workspace/folders'
);

export async function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.commands.registerCommand('simple-web-extension.hello', () => {
		vscode.window.showInformationMessage('Hello from simple-web-extension!');
	}));
	
    resolveWorkspaceFolderPaths();
	
	client = createWorkerLanguageClient(context);
	client.start().then(() => {
        console.log('Language client started successfully');
    }).catch((error) => {
        console.error('Failed to start language client:', error);
    });
	context.subscriptions.push(client);

	vscode.workspace.onDidChangeWorkspaceFolders(async (e) => {
		console.log("onDidChangeWorkspaceFolders: ", e)
		resolveWorkspaceFolderPaths();
	})

	vscode.workspace.onDidChangeTextDocument((event) => {
		const filePath = event.document.uri.path;
		if (filePath.endsWith('Config.toml')) {
			console.log(`Config.toml modified: `, event.document);
			resolveWorkspaceFolderPaths(); 
		}
	});

}

async function resolveWorkspaceFolderPaths() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    const details = await Promise.all(
        workspaceFolders.map(async (folder) => {
            const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, 'Config.toml'), null, 1);
            if (files.length > 0) {
                const fileContent = await vscode.workspace.fs.readFile(files[0]);
                const contentAsString = new TextDecoder('utf-8').decode(fileContent);
                const localFolderPath = parseToml(contentAsString)['localPath'];
				if (localFolderPath == undefined) {
					vscode.window.showErrorMessage("Config.toml doesn't contain localPath property in the project: ", folder.uri.fsPath)
				}
				vscode.window.showInformationMessage(`Config.toml file found in the project: ${folder.uri.fsPath}. Resolving path...`)
                return {
                    relativePath: `file:///${folder.name}`,
                    absolutePath: `file:///${localFolderPath}`,
                };
            }
			vscode.window.showErrorMessage("Config.toml file not found in the project: ", folder.uri.fsPath)
            return null; 
        })
    );

    const validDetails = details.filter((detail) => detail !== null) as WorkspaceFolderPath[];
    console.log('Final workspace details:', validDetails);

    if (client) {
        client.sendNotification(WorkspaceFoldersNotification, validDetails);
    }

}

function createWorkerLanguageClient(context: vscode.ExtensionContext): lc.LanguageClient {
	const serverMain = vscode.Uri.joinPath(context.extensionUri, 'server/dist/browserServerMain.js');
	const worker = new Worker(serverMain.toString(true));
	console.log('Worker created with script:', serverMain.toString(true));
	return new lc.LanguageClient('ballerinalangClient', 'Ballerina Language Client', getClientOptions(), worker);
}

function getClientOptions(): lc.LanguageClientOptions {
	return {
		documentSelector: [
            { scheme: 'file', language: "ballerina" },
            { scheme: 'file', language: "toml"}
        ],
        synchronize: { configurationSection: "ballerina" },
        initializationOptions: {
            "enableSemanticHighlighting": <string>vscode.workspace.getConfiguration().get("kolab.enableSemanticHighlighting"),
			"enableInlayHints": <string>vscode.workspace.getConfiguration().get("kolab.enableInlayHints"),
			"supportBalaScheme": "true",
			"supportQuickPick": "true",
			"supportPositionalRenamePopup": "true"
        },
        outputChannel: vscode.window.createOutputChannel('Ballerina'),
        traceOutputChannel: vscode.window.createOutputChannel('Trace'),
	};
}

function parseToml(content: string): Record<string, any> {
    const result: Record<string, any> = {};
    const lines = content.split('\n');

    for (const line of lines) {
        const trimmedLine = line.trim();

        if (!trimmedLine || trimmedLine.startsWith('#')) {
            continue;
        }

        const keyValueMatch = trimmedLine.match(/^([\w\-\.]+)\s*=\s*["']?([^"']+)["']?$/);
        if (keyValueMatch) {
            const key = keyValueMatch[1];
            let value: any = keyValueMatch[2];

            if (value === 'true' || value === 'false') {
                value = value === 'true';
            } else if (!isNaN(Number(value))) {
                value = Number(value);
            }

            result[key] = value;
        }
    }

    return result;
}

export async function deactivate(): Promise<void> {
	if (client) {
        await client.stop();
        client = undefined;
    }
}
