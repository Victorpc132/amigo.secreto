# Como colocar o site na internet

## A regra mais importante

Este site guarda tudo num arquivo (`amigo-secreto.db`). Então a hospedagem precisa ter **disco persistente** (também chamado de *volume*): uma pasta que **não é apagada** quando o site reinicia ou recebe uma versão nova.

Sem disco persistente, **todos os grupos somem** a cada reinício. Muitos planos gratuitos não têm esse disco, então confira antes de escolher. Não consegui verificar os preços atuais de nenhuma hospedagem, então olhe o site de cada uma.

## Caminho 1: hospedagem pronta (a mais fácil)

Serve **Render**, **Railway**, **Fly.io** ou parecidas. Todas aceitam o `Dockerfile` que já está no projeto.

1. Crie uma conta no [GitHub](https://github.com) e envie esta pasta para um repositório (no VS Code: Controle de Código-Fonte → Publicar no GitHub).
2. Na hospedagem escolhida, crie um novo serviço web a partir desse repositório. Ela detecta o `Dockerfile` sozinha.
3. Adicione um **disco/volume** e monte ele na pasta `/data`.
4. Confira estas variáveis (o `Dockerfile` já define, mas vale checar): `DATA_DIR=/data` e `TRUST_PROXY=true`.
5. Faça o deploy. A hospedagem te dá um endereço (ex.: `meu-amigo-secreto.exemplo.app`).
6. Abra o endereço, crie um grupo de teste e confira se ele continua lá depois de reiniciar o serviço.

Dica: o site responde em `/healthz`. Se a hospedagem pedir uma "rota de saúde", use essa.

## Caminho 2: servidor próprio (VPS)

Se você tem um servidor Linux com [Docker](https://docs.docker.com/engine/install/):

```bash
git clone <seu-repositorio> amigo-secreto && cd amigo-secreto
docker build -t amigo-secreto .
docker run -d --name amigo-secreto --restart unless-stopped \
  -p 3000:3000 -v amigo-data:/data amigo-secreto
```

O `-v amigo-data:/data` é o disco persistente. Para ter `https://` e um domínio bonito, coloque na frente um servidor como o [Caddy](https://caddyserver.com), que cuida do certificado sozinho.

## Depois de publicar

- **Backup:** copie de vez em quando o arquivo `/data/amigo-secreto.db`. Se for pouco uso, nem precisa.
- **Atualizar o site:** envie o código novo para o GitHub; a hospedagem faz o deploy. Os grupos continuam, porque ficam no disco.
- **HTTPS:** hospedagens prontas já entregam. É necessário para o botão "Copiar link" funcionar em todos os navegadores.
- **Domínio próprio:** opcional; todas as hospedagens permitem apontar um domínio seu.

> O `Dockerfile` não foi testado aqui (esta máquina não tinha acesso à internet para baixar a imagem base). O site em si foi testado rodando de verdade com `bun`. Se o build falhar, me mande a mensagem de erro.
