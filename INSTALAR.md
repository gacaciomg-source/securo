# Securo Casal: como instalar na sua VPS

Esta é uma versão do [Securo](https://github.com/securo-finance/securo) adaptada para usar em casal e em família, no mesmo servidor:

- **Open Finance por pessoa:** cada um conecta os próprios bancos com a sua conta grátis do [Meu Pluggy](https://meu.pluggy.ai). O plano grátis só aceita contas do mesmo titular (CPF), então cada pessoa precisa da sua.
- **A chave do servidor é só do administrador:** se o `.env` tiver `PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET`, só quem é administrador conecta bancos por ela. Qualquer outra pessoa, ao clicar em Pluggy, vê uma janela pedindo as próprias chaves, com o passo a passo de onde pegá-las. Assim ninguém gasta a cota do Pluggy de outra pessoa sem querer. Para voltar ao jeito antigo (chave do servidor para todo mundo), ponha `PLUGGY_INSTANCE_KEYS_ADMIN_ONLY=false` no `.env`.

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

No Securo, em **Contas → Conectar banco → Pluggy**, quem ainda não tem chaves vê a janela abaixo na hora. Também dá para abrir pelo menu da sua foto (canto superior direito) em **Minhas chaves do Open Finance**.

1. Crie sua conta grátis em [meu.pluggy.ai](https://meu.pluggy.ai) (e-mail e senha, sem convite).
2. Lá dentro, clique em **Conectar Minha Conta**, escolha o banco e autorize no app dele. Espere voltar para o Meu Pluggy: a conta aparece com saldo e extrato.
3. Crie também uma conta, com o mesmo e-mail, em [dashboard.pluggy.ai](https://dashboard.pluggy.ai). Ignore o aviso de teste de 15 dias; ele não vale para uso pessoal.
4. No painel, crie **uma** aplicação (uma só basta para todos os bancos).
5. Abra a aba **Aplicação** dessa aplicação e copie o *Client ID* e o *Client Secret*.
6. Cole os dois na janela do Securo e clique em **Testar e salvar**. O Securo confere com a Pluggy antes de guardar.
7. Na hora de conectar o banco, escolha **MeuPluggy** na lista (não o banco direto) e entre com a conta do Meu Pluggy.

As chaves ficam guardadas criptografadas e ninguém consegue vê-las de novo, nem o administrador.

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
