const vscode = require('vscode');
const pathModule = require('path');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    context.subscriptions.push(vscode.commands.registerCommand('copyActiveFilesTree.copyTree', async () => {
        const openPaths = getOpenTabPaths();
        if (openPaths.length === 0) {
            vscode.window.showInformationMessage('No files open.');
            return;
        }

        const mainRoot = buildMainTree(openPaths);
        const treeStr = printTree(mainRoot);
        await vscode.env.clipboard.writeText(treeStr);
        vscode.window.showInformationMessage('Copied tree to clipboard.');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('copyActiveFilesTree.copyTreeWithContents', async () => {
        const openPaths = getOpenTabPaths();
        if (openPaths.length === 0) {
            return;
        }

        const mainRoot = buildMainTree(openPaths);
        const treeStr = printTree(mainRoot);
        const files = collectFiles(mainRoot);
        files.sort((a, b) => a.path.localeCompare(b.path));

        let xml = '<files>\n<tree>\n' + treeStr + '\n</tree>\n';
        for (const file of files) {
            let content = '';
            try {
                const uri = vscode.Uri.file(file.fullPath);
                const fileData = await vscode.workspace.fs.readFile(uri);
                content = new TextDecoder('utf-8').decode(fileData);
            } catch (err) {
                console.error(`Error reading file ${file.fullPath}: ${err}`);
            }
            xml += '<file path="' + file.path.replace(/"/g, '"') + '">\n' + content + '\n</file>\n';
        }
        xml += '</files>';

        await vscode.env.clipboard.writeText(xml);
        vscode.window.showInformationMessage('Copied XML tree with contents to clipboard.');
    }));
}

function getOpenTabPaths() {
    const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
    return tabs
        .filter(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === 'file')
        .map(tab => tab.input.uri.fsPath);
}

function buildMainTree(openPaths) {
    const roots = vscode.workspace.workspaceFolders || [];
    const workspaceFiles = new Map();
    const outsideFiles = [];

    openPaths.forEach(filePath => {
        let matchingWorkspace = null;
        let maxLength = -1;
        roots.forEach(ws => {
            const rootPath = ws.uri.fsPath;
            if (filePath.startsWith(rootPath) && rootPath.length > maxLength) {
                maxLength = rootPath.length;
                matchingWorkspace = ws;
            }
        });
        if (matchingWorkspace) {
            const rootPath = matchingWorkspace.uri.fsPath;
            if (!workspaceFiles.has(rootPath)) {
                workspaceFiles.set(rootPath, []);
            }
            workspaceFiles.get(rootPath).push(filePath);
        } else {
            outsideFiles.push(filePath);
        }
    });

    const mainRoot = {};

    // Handle workspace groups
    for (const [rootPath, groupPaths] of workspaceFiles) {
        const ws = roots.find(w => w.uri.fsPath === rootPath);
        const rootName = ws.name;
        const groupTree = {};
        for (const fullPath of groupPaths) {
            const relPath = pathModule.relative(rootPath, fullPath);
            const parts = relPath.split(/[\\/]/).filter(p => p.length > 0);
            let current = groupTree;
            for (let j = 0; j < parts.length; j++) {
                const part = parts[j];
                if (!current[part]) {
                    current[part] = {};
                }
                current = current[part];
                if (j === parts.length - 1) {
                    current.__file = true;
                    current.__fullPath = fullPath;
                }
            }
        }
        if (Object.keys(groupTree).length > 0) {
            mainRoot[rootName] = groupTree;
        }
    }

    // Handle outside files
    if (outsideFiles.length > 0) {
        const normalizedPaths = outsideFiles.map(p => p.replace(/\\/g, '/'));
        const commonPrefix = findCommonPrefix(normalizedPaths);
        let rootName = '';
        let relativePaths = normalizedPaths.map((p) => p.substring(commonPrefix.length));
        if (commonPrefix.length > 0) {
            const prefixParts = commonPrefix.split('/').filter(p => p.length > 0);
            rootName = prefixParts.length > 0 ? prefixParts.pop() : '/';
        }

        const outsideTree = {};
        for (let i = 0; i < outsideFiles.length; i++) {
            const relPath = relativePaths[i];
            const fullPath = outsideFiles[i];
            const parts = relPath.split('/').filter(p => p.length > 0);
            let current = outsideTree;
            for (let j = 0; j < parts.length; j++) {
                const part = parts[j];
                if (!current[part]) {
                    current[part] = {};
                }
                current = current[part];
                if (j === parts.length - 1) {
                    current.__file = true;
                    current.__fullPath = fullPath;
                }
            }
        }

        if (rootName) {
            mainRoot[rootName] = outsideTree;
        } else {
            // No common prefix, build tree from full paths
            const fullTree = {};
            for (const fullPath of outsideFiles) {
                const parts = fullPath.split(/[\\/]/).filter(p => p.length > 0);
                let current = fullTree;
                for (let j = 0; j < parts.length; j++) {
                    const part = parts[j];
                    if (!current[part]) {
                        current[part] = {};
                    }
                    current = current[part];
                    if (j === parts.length - 1) {
                        current.__file = true;
                        current.__fullPath = fullPath;
                    }
                }
            }
            Object.assign(mainRoot, fullTree);
        }
    }

    return mainRoot;
}

function findCommonPrefix(paths) {
    if (paths.length === 0) return '';
    let prefix = paths[0];
    for (let i = 1; i < paths.length; i++) {
        while (prefix.length > 0 && !paths[i].startsWith(prefix)) {
            prefix = prefix.slice(0, -1);
        }
        if (prefix.length === 0) return '';
    }
    const lastSep = Math.max(prefix.lastIndexOf('/'), prefix.lastIndexOf('\\'));
    if (lastSep >= 0) {
        prefix = prefix.slice(0, lastSep + 1);
    } else {
        prefix = '';
    }
    return prefix;
}

function printTree(mainRoot) {
    let result = '';
    const rootEntries = Object.entries(mainRoot).sort((a, b) => a[0].localeCompare(b[0]));
    for (let i = 0; i < rootEntries.length; i++) {
        const [key, node] = rootEntries[i];
        const isDir = Object.keys(node).some(k => k !== '__file' && k !== '__fullPath');
        result += key + (isDir ? '/' : '') + '\n';
        result += printChildren(node, '');
        if (i < rootEntries.length - 1) {
            result += '\n'; // Optional separator for multiple roots
        }
    }
    return result.trim();
}

function printChildren(node, prefix) {
    let result = '';
    const entries = Object.entries(node).filter(([key]) => key !== '__file' && key !== '__fullPath');
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    for (let i = 0; i < entries.length; i++) {
        const [key, child] = entries[i];
        const childIsLast = i === entries.length - 1;
        const isDir = Object.keys(child).some(k => k !== '__file' && k !== '__fullPath');
        const line = prefix + (childIsLast ? '└── ' : '├── ') + key + (isDir ? '/' : '');
        result += line + '\n';
        const newPrefix = prefix + (childIsLast ? '    ' : '│   ');
        result += printChildren(child, newPrefix);
    }
    return result;
}

function collectFiles(node, pathSoFar = [], files = []) {
    const entries = Object.entries(node).filter(([key]) => key !== '__file' && key !== '__fullPath');
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    for (const [key, child] of entries) {
        const currentPath = [...pathSoFar, key];
        if (child.__file) {
            files.push({path: currentPath.join('/'), fullPath: child.__fullPath});
        } else {
            collectFiles(child, currentPath, files);
        }
    }
    return files;
}

module.exports = {
    activate
};