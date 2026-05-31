# FIN-OS

Web app responsive para ordenar finanzas personales desde cero cada mes.

## Objetivo

FIN-OS ayuda a:

- Cargar gastos con baja friccion.
- Entender en que se va la plata.
- Saber cuanto se puede gastar durante el mes.
- Cumplir un objetivo de ahorro.
- Evitar pasarse de presupuesto.
- Separar gastos fijos, variables, ahorros e inversiones simples.

## Estado inicial

La app arranca en cero real:

- Ingresos: $0
- Gastos: $0
- Ahorro: $0
- Inversiones: $0
- Disponible: $0
- Presupuestos: sin configurar
- Insights: sin datos suficientes

No muestra gastos, ingresos, presupuestos ni inversiones ficticias como estado inicial.

## Funcionalidades

- Dashboard responsive.
- Flujo de configuracion mensual.
- Registro rapido de gastos, ingresos, ahorros e inversiones.
- Categorias y gastos recurrentes.
- Presupuestos variables.
- Objetivo sugerido de ahorro del 40% del ingreso mensual.
- Aviso cuando Casa y servicios supera el 30% recomendado del ingreso.
- Toggle ARS/USD.
- Cotizacion de dolar oficial, blue y MEP via DolarApi con fallback local.

## Ejecutar localmente

```bash
npm start
```

Luego abrir:

```text
http://127.0.0.1:4173
```

Tambien se puede usar cualquier servidor estatico que sirva `index.html`.

## Estructura

```text
index.html
dev-server.cjs
assets/
  finance-app.js
  finance-calculations.js
  finance-currency.js
  finance-data.js
  finance-services.js
  finance-styles.css
```
