# Securo Casal: como instalar na sua VPS

Esta é uma versão do [Securo](https://github.com/securo-finance/securo) adaptada para usar em casal e em família, no mesmo servidor:

- **Open Finance por pessoa:** cada um conecta os próprios bancos com a sua conta grátis do [Meu Pluggy](https://meu.pluggy.ai). O plano grátis só aceita contas do mesmo titular (CPF), então cada pessoa precisa da sua.

O código fica na branch `casal`. As melhorias são montadas direto no seu servidor (as imagens prontas do projeto oficial não têm essas mudanças).

## O que você precisa

- Uma VPS com Ubuntu 22.04 ou 24.04 e **pelo menos 2 GB de RAM** (4 GB deixa a montagem bem mais rápida).
- Um domínio ou subdomínio apontando para o IP da VPS, por exemplo `financas.seudominio.com.br`. É ele que dá o cadeado (HTTPS).

## 1. Instalar o Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
```

## 2. Baixar o Securo Casal

```bash
git clone -b casal https://github.com/gacaciomg-source/securo.git securo-casal
cd securo-casal
```

## 3. Configurar

```bash
cp .env.example .env
openssl rand -hex 32
```

Abra o `.env` (`nano .env`) e ajuste:

```ini
# Cole aqui o código que o openssl gerou. Guarde uma cópia em lugar seguro:
# sem ela, as chaves do Pluggy salvas no sistema param de funcionar.
SECRET_KEY=cole-o-codigo-aqui

FRONTEND_URL=https://financas.seudominio.com.br

# Só o próprio servidor acessa as portas; o Caddy (passo 5) fica na frente.
FRONTEND_PORT=127.0.0.1:3000
BACKEND_PORT=127.0.0.1:8000
```

Pode deixar `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` em branco: cada pessoa salva as próprias chaves dentro do app.

## 4. Subir o sistema

```bash
sudo docker compose -f docker-compose.prod.yml -f docker-compose.casal.yml up -d --build
```

Na primeira vez a montagem leva alguns minutos.

## 5. Colocar HTTPS com o Caddy

```bash
sudo apt install -y caddy
echo 'financas.seudominio.com.br {
  reverse_proxy 127.0.0.1:3000
}' | sudo tee /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Abra `https://financas.seudominio.com.br`. A primeira conta criada vira a administradora. Em **Administração**, confira o fuso horário (America/Sao_Paulo), crie as contas das outras pessoas e depois desligue os cadastros novos.

## 6. Conectar os bancos (cada pessoa faz o seu)

1. Crie sua conta grátis em [meu.pluggy.ai](https://meu.pluggy.ai) e conecte seus bancos lá.
2. No Securo, abra o menu da sua foto (canto superior direito) e vá em **Minhas chaves do Open Finance**.
3. Siga o passo a passo da tela, cole o *Client ID* e o *Client Secret* e clique em **Testar e salvar**.
4. Em **Contas**, conecte o banco normalmente.

## Atualizar

```bash
cd securo-casal
git pull
sudo docker compose -f docker-compose.prod.yml -f docker-compose.casal.yml up -d --build
```

## Backup (faça sempre)

```bash
sudo docker compose -f docker-compose.prod.yml exec -T db pg_dump -U postgres securo > backup-$(date +%F).sql
```

Copie o arquivo para fora da VPS (seu PC, Google Drive etc.). Junto com o `.env`, ele é tudo que você precisa para recuperar o sistema.
