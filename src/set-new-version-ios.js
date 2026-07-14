const fs = require("fs");
const path = require("path");
const xml2js = require("xml2js");

const builder = new xml2js.Builder({
    xmldec: {
        version: "1.0",
        encoding: "UTF-8"
    }
});

// Lê NEW_VERSION de config.xml
async function getNewVersionFromConfig(configXmlPath) {
    try {
        const xmlContent = fs.readFileSync(configXmlPath, "utf-8");
        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(xmlContent);

        if (result.widget && result.widget.preference) {
            const preference = result.widget.preference.find(p => p.$.name === "NEW_VERSION");
            return preference ? preference.$.value : "";
        }
        return "";
    } catch (err) {
        console.error("[New Version][iOS] Erro ao ler NEW_VERSION do config.xml:", err);
        return "";
    }
}

// Atualiza todos os Info.plist encontrados em platforms/ios (apenas XML)
function updateIosPlists(projectRoot, newVersion) {
    const iosRoot = path.join(projectRoot, "platforms", "ios");
    if (!fs.existsSync(iosRoot)) {
        console.log("[New Version][iOS] pasta platforms/ios não encontrada. Pulando atualização iOS.");
        return;
    }

    const plistFiles = [];
    (function walk(dir) {
        const entries = fs.readdirSync(dir);
        for (const name of entries) {
            const full = path.join(dir, name);
            const stat = fs.statSync(full);
            if (stat.isDirectory()) {
                if (name === "node_modules" || name === "Pods") continue;
                walk(full);
            } else {
                if (name === "Info.plist" && !full.includes("PrivacyInfo")) {
                    plistFiles.push(full);
                }
            }
        }
    })(iosRoot);

    if (plistFiles.length === 0) {
        console.log("[New Version][iOS] Nenhum Info.plist encontrado em platforms/ios.");
        return;
    }

    for (const plistPath of plistFiles) {
        try {
            let content = fs.readFileSync(plistPath, "utf8");

            // Se for plist binário, pedir conversão (não tenta converter automaticamente)
            if (!content.trim().startsWith("<?xml")) {
                console.log(`[New Version][iOS] Info.plist em formato binário detectado em ${plistPath}. Converta com: plutil -convert xml1 "${plistPath}"`);
                continue;
            }

            let modified = false;

            // Atualiza CFBundleShortVersionString
            const shortVersionRegex = /(<key>\s*CFBundleShortVersionString\s*<\/key>\s*<string>)([\s\S]*?)(<\/string>)/;
            if (shortVersionRegex.test(content)) {
                content = content.replace(shortVersionRegex, (_, p1, _old, p3) => {
                    modified = true;
                    return p1 + newVersion + p3;
                });
                console.log(`[New Version][iOS] CFBundleShortVersionString atualizado em ${plistPath}`);
            } else {
                console.log(`[New Version][iOS] CFBundleShortVersionString não encontrado em ${plistPath}`);
            }

            // Atualiza/incrementa CFBundleVersion (build number) se for numérico
            const buildRegex = /(<key>\s*CFBundleVersion\s*<\/key>\s*<string>)([\s\S]*?)(<\/string>)/;
            if (buildRegex.test(content)) {
                content = content.replace(buildRegex, (_, p1, oldVal, p3) => {
                    const oldTrim = oldVal.trim();
                    let newBuild = oldTrim;
                    if (/^\d+$/.test(oldTrim)) {
                        newBuild = String(parseInt(oldTrim, 10) + 1);
                    }
                    modified = true;
                    return p1 + newBuild + p3;
                });
                console.log(`[New Version][iOS] CFBundleVersion atualizado em ${plistPath}`);
            } else {
                console.log(`[New Version][iOS] CFBundleVersion não encontrado em ${plistPath}`);
            }

            if (modified) {
                fs.writeFileSync(plistPath, content, "utf8");
                console.log(`[New Version][iOS] Info.plist salvo: ${plistPath}`);
            }
        } catch (err) {
            console.error(`[New Version][iOS] Erro ao atualizar ${plistPath}:`, err);
        }
    }
}

// Função principal para hook Cordova — agora limitada ao iOS
async function setIosVersion(context) {
    const projectRoot = context && context.opts && context.opts.projectRoot ? context.opts.projectRoot : process.cwd();
    const configXmlPath = path.join(projectRoot, "config.xml");

    console.log(`[New Version][iOS] projectRoot: ${projectRoot}`);

    if (!fs.existsSync(configXmlPath)) {
        console.error(`[New Version][iOS] Arquivo config.xml não encontrado em: ${configXmlPath}`);
        return;
    }

    const newVersion = await getNewVersionFromConfig(configXmlPath);
    if (!newVersion) {
        console.log("[New Version][iOS] Variável NEW_VERSION não definida ou inválida. Nenhuma ação será realizada.");
        return;
    }
    try {
        // CORRECÇÃO: Atualiza a versão no config.xml via Regex para não quebrar o resto da estrutura XML
        let xmlContent = fs.readFileSync(configXmlPath, "utf-8");

        // Atualiza o atributo version="X.X.X" na tag <widget>
        const widgetRegex = /(<widget[^>]*?\sversion=")([^"]*)(")/;
        if (widgetRegex.test(xmlContent)) {
            xmlContent = xmlContent.replace(widgetRegex, `$1${newVersion}$3`);
            console.log(`[New Version][iOS] Atributo version atualizado para ${newVersion} no config.xml`);
        }

        // Remove a preferência NEW_VERSION para limpar o ficheiro
        const prefRegex = /<preference\s+name="NEW_VERSION"\s+value="[^"]*"\s*\/?>\r?\n?/g;
        xmlContent = xmlContent.replace(prefRegex, "");

        fs.writeFileSync(configXmlPath, xmlContent, "utf-8");
        console.log("[New Version][iOS] config.xml guardado com sucesso via Regex.");

        // Atualiza Info.plist(s)
        updateIosPlists(projectRoot, newVersion);
    } catch (err) {
        console.error("[New Version][iOS] Erro ao modificar o config.xml ou plists:", err);
    }
}

module.exports = setIosVersion;